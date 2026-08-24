import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile, realpath } from 'node:fs/promises';
import { extname, join, relative, resolve, sep } from 'node:path';
import { HeadlessHost } from "./headless-host.js";
import { assertJsonValue } from "./json.js";
export class AgentServerError extends Error {
    code;
    status;
    details;
    constructor(message, code, status = 400, details) {
        super(message);
        this.code = code;
        this.status = status;
        this.details = details;
    }
}
/** 真正的 Agent Server：HTTP RPC 控制面 + SSE Session Event 数据面。 */
export class AgentServer {
    #host;
    #options;
    #conversations = new Map();
    #idempotency = new Map();
    #sse = new Set();
    #server;
    #closing = false;
    constructor(host, options) {
        if (options.authToken.length < 16)
            throw new TypeError('Agent Server authToken 至少 16 字符');
        this.#host = host;
        this.#options = {
            host: options.host ?? '127.0.0.1', port: options.port ?? 0, authToken: options.authToken,
            maxRequestBytes: options.maxRequestBytes ?? 1024 * 1024,
            maxSseQueueBytes: options.maxSseQueueBytes ?? 1024 * 1024,
            heartbeatMs: options.heartbeatMs ?? 15_000,
            idempotencyEntries: options.idempotencyEntries ?? 1_000,
            ...(options.webRoot === undefined ? {} : { webRoot: resolve(options.webRoot) }),
            ...(options.attachments === undefined ? {} : { attachments: options.attachments }),
            ...(options.interactions === undefined ? {} : { interactions: options.interactions }),
        };
    }
    async listen() {
        if (this.#server !== undefined)
            throw new Error('Agent Server 已监听');
        const server = createServer((request, response) => { void this.#handle(request, response); });
        this.#server = server;
        server.listen(this.#options.port, this.#options.host);
        await once(server, 'listening');
        const address = server.address();
        return { host: this.#options.host, port: address.port, url: `http://${this.#options.host}:${address.port}` };
    }
    async close() {
        if (this.#closing)
            return;
        this.#closing = true;
        for (const client of this.#sse)
            client.close();
        const server = this.#server;
        this.#server = undefined;
        let serverClosed;
        if (server !== undefined) {
            serverClosed = new Promise((resolve, reject) => server.close(error => error === undefined ? resolve() : reject(error)));
            server.closeIdleConnections();
        }
        const conversations = [...this.#conversations.values()];
        for (const conversation of conversations)
            conversation.agent.cancel(new Error('Agent Server 关闭'));
        await Promise.all(conversations.map(conversation => conversation.close()));
        this.#conversations.clear();
        server?.closeAllConnections();
        await serverClosed;
        await this.#host.dispose();
        this.#options.interactions?.dispose();
    }
    async #handle(request, response) {
        try {
            if (this.#closing)
                throw new AgentServerError('Server 正在关闭', 'SERVER_CLOSING', 503);
            const url = new URL(request.url ?? '/', 'http://localhost');
            if (request.method === 'GET' && url.pathname === '/health') {
                response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
                response.end('{"status":"ok"}');
                return;
            }
            if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname !== '/events' && this.#options.webRoot !== undefined) {
                await this.#static(url.pathname, request.method, response);
                return;
            }
            this.#authorize(request);
            if (request.method === 'POST' && url.pathname === '/attachments') {
                await this.#uploadAttachment(request, response);
                return;
            }
            if (request.method === 'POST' && url.pathname === '/attachment/read') {
                await this.#readAttachment(request, response);
                return;
            }
            if (request.method === 'POST' && url.pathname === '/rpc') {
                await this.#rpc(request, response);
                return;
            }
            if (request.method === 'GET' && url.pathname === '/events') {
                this.#events(url, request, response);
                return;
            }
            throw new AgentServerError('Route 不存在', 'NOT_FOUND', 404);
        }
        catch (error) {
            if (response.headersSent) {
                response.destroy();
                return;
            }
            const normalized = normalizeError(error);
            response.writeHead(normalized.status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
            response.end(JSON.stringify({ error: { code: normalized.code, message: normalized.message } }));
        }
    }
    async #uploadAttachment(request, response) {
        const store = this.#options.attachments;
        if (store === undefined)
            throw new AgentServerError('Attachment capability 未配置', 'CAPABILITY_UNAVAILABLE', 503);
        const mediaType = request.headers['content-type']?.split(';', 1)[0];
        if (!isImageMediaType(mediaType))
            throw new AgentServerError('Content-Type 必须是支持的图片类型', 'INVALID_ATTACHMENT', 415);
        const data = await readBodyBuffer(request, this.#options.maxRequestBytes);
        const rawName = request.headers['x-file-name'];
        const ref = await store.saveImage({
            data, mediaType,
            ...(typeof rawName === 'string' ? { name: decodeURIComponent(rawName) } : {}),
        });
        response.writeHead(201, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        response.end(JSON.stringify(ref));
    }
    async #readAttachment(request, response) {
        const store = this.#options.attachments;
        if (store === undefined)
            throw new AgentServerError('Attachment capability 未配置', 'CAPABILITY_UNAVAILABLE', 503);
        const raw = JSON.parse(await readBody(request, this.#options.maxRequestBytes));
        assertJsonValue(raw);
        const ref = parseAttachmentRef(raw);
        const data = await store.readImage(ref);
        response.writeHead(200, { 'content-type': ref.mediaType, 'content-length': data.byteLength, 'cache-control': 'private, max-age=300' });
        response.end(data);
    }
    async #static(pathname, method, response) {
        const root = this.#options.webRoot;
        if (root === undefined)
            throw new AgentServerError('Web 未启用', 'NOT_FOUND', 404);
        let decoded;
        try {
            decoded = decodeURIComponent(pathname);
        }
        catch {
            throw new AgentServerError('静态路径编码无效', 'INVALID_PATH', 400);
        }
        const leaf = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
        if (leaf.split('/').some(segment => segment === '..' || segment.startsWith('.')))
            throw new AgentServerError('静态路径无效', 'INVALID_PATH', 400);
        const rootReal = await realpath(root);
        let fileReal;
        try {
            fileReal = await realpath(join(rootReal, leaf));
        }
        catch {
            throw new AgentServerError('静态资源不存在', 'NOT_FOUND', 404);
        }
        const inside = relative(rootReal, fileReal);
        if (inside === '..' || inside.startsWith(`..${sep}`))
            throw new AgentServerError('静态路径逃逸', 'INVALID_PATH', 400);
        const data = await readFile(fileReal);
        response.writeHead(200, {
            'content-type': mimeType(extname(fileReal)),
            'content-length': data.byteLength,
            'cache-control': extname(fileReal) === '.html' ? 'no-cache' : 'public, max-age=300',
            'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'",
            'x-content-type-options': 'nosniff',
            'referrer-policy': 'no-referrer',
        });
        response.end(method === 'HEAD' ? undefined : data);
    }
    #authorize(request) {
        const authorization = request.headers.authorization;
        const supplied = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
        const expectedHash = createHash('sha256').update(this.#options.authToken).digest();
        const suppliedHash = createHash('sha256').update(supplied).digest();
        if (!timingSafeEqual(expectedHash, suppliedHash))
            throw new AgentServerError('Unauthorized', 'UNAUTHORIZED', 401);
    }
    async #rpc(request, response) {
        const body = await readBody(request, this.#options.maxRequestBytes);
        let raw;
        try {
            raw = JSON.parse(body);
        }
        catch {
            throw new AgentServerError('RPC JSON 无效', 'PARSE_ERROR', 400);
        }
        assertJsonValue(raw);
        const rpc = parseRpc(raw);
        const key = String(rpc.id);
        const fingerprint = createHash('sha256').update(`${rpc.method}\0${JSON.stringify(rpc.params ?? {})}`).digest('hex');
        const previous = this.#idempotency.get(key);
        let pending;
        if (previous !== undefined) {
            if (previous.fingerprint !== fingerprint) {
                pending = Promise.resolve(rpcFailure(rpc.id, new AgentServerError('相同 RPC id 对应不同命令', 'IDEMPOTENCY_CONFLICT', 409)));
            }
            else
                pending = previous.response;
        }
        else {
            pending = this.#dispatch(rpc).then(result => ({ jsonrpc: '2.0', id: rpc.id, result }), error => rpcFailure(rpc.id, error));
            this.#idempotency.set(key, { fingerprint, response: pending });
            while (this.#idempotency.size > this.#options.idempotencyEntries) {
                const oldest = this.#idempotency.keys().next().value;
                if (oldest === undefined)
                    break;
                this.#idempotency.delete(oldest);
            }
        }
        const result = await pending;
        response.writeHead('error' in result ? statusForCode(result.error.code) : 200, {
            'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
        });
        response.end(JSON.stringify(result));
    }
    async #dispatch(request) {
        const params = request.params ?? {};
        switch (request.method) {
            case 'session.create': {
                const requested = optionalString(params, 'sessionId');
                const conversation = await this.#host.create(requested);
                if (this.#conversations.has(conversation.header.id)) {
                    await conversation.close();
                    throw new AgentServerError('Session 已激活', 'SESSION_ACTIVE', 409);
                }
                this.#conversations.set(conversation.header.id, conversation);
                return { sessionId: conversation.header.id, createdAt: conversation.header.createdAt };
            }
            case 'session.resume': {
                const sessionId = requiredString(params, 'sessionId');
                if (this.#conversations.has(sessionId))
                    throw new AgentServerError('Session 已激活', 'SESSION_ACTIVE', 409);
                const conversation = await this.#host.resume(sessionId);
                this.#conversations.set(sessionId, conversation);
                return { sessionId, nextSeq: conversation.session.events.length };
            }
            case 'session.send': {
                const conversation = this.#conversation(requiredString(params, 'sessionId'));
                if (conversation.agent.status !== 'idle')
                    throw new AgentServerError('Agent 正忙', 'AGENT_BUSY', 409);
                const text = optionalString(params, 'text');
                const attachmentValues = params.attachments;
                if (attachmentValues !== undefined && !Array.isArray(attachmentValues))
                    throw new AgentServerError('attachments 必须是数组', 'INVALID_PARAMS');
                const attachments = (attachmentValues ?? []).map(parseAttachmentRef);
                if (text === undefined && attachments.length === 0)
                    throw new AgentServerError('text/attachments 至少提供一个', 'INVALID_PARAMS');
                const store = this.#options.attachments;
                if (attachments.length > 0 && store === undefined)
                    throw new AgentServerError('Attachment capability 未配置', 'CAPABILITY_UNAVAILABLE', 503);
                for (const ref of attachments)
                    await store?.readImage(ref);
                return conversation.runContent([
                    ...(text === undefined ? [] : [{ type: 'text', text }]),
                    ...attachments.map(attachment => ({ type: 'image', attachment })),
                ]);
            }
            case 'session.cancel': {
                const conversation = this.#conversation(requiredString(params, 'sessionId'));
                conversation.agent.cancel(new Error(optionalString(params, 'reason') ?? 'remote cancel'));
                return { accepted: conversation.agent.status === 'running' };
            }
            case 'session.snapshot': {
                const conversation = this.#conversation(requiredString(params, 'sessionId'));
                return { sessionId: conversation.header.id, status: conversation.agent.status, events: conversation.session.events };
            }
            case 'session.close': {
                const sessionId = requiredString(params, 'sessionId');
                const conversation = this.#conversation(sessionId);
                if (conversation.agent.status === 'running')
                    throw new AgentServerError('运行中的 Session 不能直接关闭', 'AGENT_BUSY', 409);
                this.#conversations.delete(sessionId);
                await conversation.close();
                return { closed: true };
            }
            case 'interaction.list': {
                const sessionId = requiredString(params, 'sessionId');
                this.#conversation(sessionId);
                return { interactions: this.#options.interactions?.list(sessionId) ?? [] };
            }
            case 'interaction.answer': {
                const sessionId = requiredString(params, 'sessionId');
                this.#conversation(sessionId);
                const id = requiredString(params, 'id');
                const outcome = requiredString(params, 'outcome');
                if (!['allowed-once', 'rejected', 'cancelled', 'unavailable'].includes(outcome))
                    throw new AgentServerError('审批 outcome 无效', 'INVALID_PARAMS');
                const accepted = this.#options.interactions?.answer(sessionId, id, outcome) ?? false;
                if (!accepted)
                    throw new AgentServerError('审批不存在或已经决定', 'INTERACTION_NOT_FOUND', 404);
                return { accepted: true };
            }
            default:
                throw new AgentServerError(`未知 RPC method：${request.method}`, 'METHOD_NOT_FOUND', 404);
        }
    }
    #events(url, request, response) {
        const sessionId = url.searchParams.get('sessionId');
        if (!sessionId)
            throw new AgentServerError('缺少 sessionId', 'INVALID_PARAMS', 400);
        const conversation = this.#conversation(sessionId);
        const queryAfter = Number(url.searchParams.get('after') ?? '-1');
        const headerAfter = Number(request.headers['last-event-id'] ?? '-1');
        const after = Math.max(Number.isSafeInteger(queryAfter) ? queryAfter : -1, Number.isSafeInteger(headerAfter) ? headerAfter : -1);
        response.writeHead(200, {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no',
        });
        const client = new SseClient(response, this.#options.maxSseQueueBytes, this.#options.heartbeatMs, () => this.#sse.delete(client));
        this.#sse.add(client);
        let last = after;
        const unsubscribe = conversation.session.onAppend(event => {
            if (event.seq <= last)
                return;
            last = event.seq;
            client.event(event.seq, 'session-event', event);
        });
        client.onClose(unsubscribe);
        for (const event of conversation.session.events) {
            if (event.seq <= last)
                continue;
            last = event.seq;
            client.event(event.seq, 'session-event', event);
        }
        client.comment('ready');
    }
    #conversation(sessionId) {
        const conversation = this.#conversations.get(sessionId);
        if (conversation === undefined)
            throw new AgentServerError('Session 未激活', 'SESSION_NOT_ACTIVE', 404);
        return conversation;
    }
}
class SseClient {
    #response;
    #maxBytes;
    #queue = [];
    #cleanup = [];
    #queuedBytes = 0;
    #pumping = false;
    #closed = false;
    #heartbeat;
    constructor(response, maxBytes, heartbeatMs, removed) {
        this.#response = response;
        this.#maxBytes = maxBytes;
        this.#cleanup.push(removed);
        response.once('close', () => this.close());
        this.#heartbeat = setInterval(() => this.comment('heartbeat'), heartbeatMs);
        this.#heartbeat.unref();
    }
    onClose(cleanup) { this.#cleanup.push(cleanup); }
    event(id, name, data) { this.#enqueue(`id: ${id}\nevent: ${name}\ndata: ${JSON.stringify(data)}\n\n`); }
    comment(text) { this.#enqueue(`: ${text}\n\n`); }
    close() {
        if (this.#closed)
            return;
        this.#closed = true;
        clearInterval(this.#heartbeat);
        for (const cleanup of this.#cleanup.splice(0))
            cleanup();
        this.#response.end();
    }
    #enqueue(frame) {
        if (this.#closed)
            return;
        this.#queuedBytes += Buffer.byteLength(frame);
        if (this.#queuedBytes > this.#maxBytes) {
            this.#response.destroy(new Error('SSE consumer too slow'));
            this.close();
            return;
        }
        this.#queue.push(frame);
        if (!this.#pumping)
            void this.#pump();
    }
    async #pump() {
        this.#pumping = true;
        try {
            while (!this.#closed && this.#queue.length > 0) {
                const frame = this.#queue.shift();
                if (frame === undefined)
                    continue;
                this.#queuedBytes -= Buffer.byteLength(frame);
                if (!this.#response.write(frame))
                    await Promise.race([once(this.#response, 'drain'), once(this.#response, 'close')]);
            }
        }
        catch {
            this.close();
        }
        finally {
            this.#pumping = false;
        }
    }
}
async function readBody(request, maximum) {
    return (await readBodyBuffer(request, maximum)).toString('utf8');
}
async function readBodyBuffer(request, maximum) {
    // Bun 的 node:http 兼容层可能在超小上限下先完整缓冲请求；先用声明长度 fail-fast。
    const declared = request.headers['content-length'];
    if (declared !== undefined) {
        const bytes = Number(declared);
        if (!Number.isSafeInteger(bytes) || bytes < 0)
            throw new AgentServerError('Content-Length 无效', 'INVALID_REQUEST', 400);
        if (bytes > maximum)
            throw new AgentServerError('请求体过大', 'REQUEST_TOO_LARGE', 413);
    }
    const chunks = [];
    let bytes = 0;
    for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > maximum)
            throw new AgentServerError('请求体过大', 'REQUEST_TOO_LARGE', 413);
        chunks.push(buffer);
    }
    return Buffer.concat(chunks);
}
function parseRpc(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        throw new AgentServerError('RPC envelope 必须是对象', 'INVALID_REQUEST');
    const record = value;
    if (record.jsonrpc !== '2.0' || (typeof record.id !== 'string' && typeof record.id !== 'number') || typeof record.method !== 'string') {
        throw new AgentServerError('RPC envelope 缺少 jsonrpc/id/method', 'INVALID_REQUEST');
    }
    if (record.params !== undefined && (typeof record.params !== 'object' || record.params === null || Array.isArray(record.params))) {
        throw new AgentServerError('RPC params 必须是对象', 'INVALID_PARAMS');
    }
    return { jsonrpc: '2.0', id: record.id, method: record.method, ...(record.params === undefined ? {} : { params: record.params }) };
}
function requiredString(params, key) {
    const value = params[key];
    if (typeof value !== 'string' || value.trim() === '')
        throw new AgentServerError(`参数 ${key} 必须为非空字符串`, 'INVALID_PARAMS');
    return value;
}
function optionalString(params, key) {
    return params[key] === undefined ? undefined : requiredString(params, key);
}
function normalizeError(error) {
    if (error instanceof AgentServerError)
        return error;
    return new AgentServerError(error instanceof Error ? error.message : String(error), 'INTERNAL_ERROR', 500);
}
function rpcFailure(id, error) {
    const normalized = normalizeError(error);
    return { jsonrpc: '2.0', id, error: { code: normalized.code, message: normalized.message, ...(normalized.details === undefined ? {} : { details: normalized.details }) } };
}
function statusForCode(code) {
    if (code === 'UNAUTHORIZED')
        return 401;
    if (code === 'METHOD_NOT_FOUND' || code === 'SESSION_NOT_ACTIVE')
        return 404;
    if (code === 'AGENT_BUSY' || code === 'SESSION_ACTIVE' || code === 'IDEMPOTENCY_CONFLICT')
        return 409;
    if (code === 'INTERNAL_ERROR')
        return 500;
    return 400;
}
function mimeType(extension) {
    if (extension === '.html')
        return 'text/html; charset=utf-8';
    if (extension === '.js')
        return 'text/javascript; charset=utf-8';
    if (extension === '.css')
        return 'text/css; charset=utf-8';
    if (extension === '.svg')
        return 'image/svg+xml';
    if (extension === '.json')
        return 'application/json; charset=utf-8';
    return 'application/octet-stream';
}
function isImageMediaType(value) {
    return value === 'image/png' || value === 'image/jpeg' || value === 'image/webp' || value === 'image/gif';
}
function parseAttachmentRef(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        throw new AgentServerError('Attachment ref 必须是对象', 'INVALID_ATTACHMENT');
    const record = value;
    if (typeof record.attachmentId !== 'string' || !isImageMediaType(typeof record.mediaType === 'string' ? record.mediaType : undefined)
        || !Number.isSafeInteger(record.bytes) || !Number.isSafeInteger(record.width) || !Number.isSafeInteger(record.height)
        || record.bytes <= 0 || record.width <= 0 || record.height <= 0
        || (record.name !== undefined && typeof record.name !== 'string')) {
        throw new AgentServerError('Attachment ref 字段无效', 'INVALID_ATTACHMENT');
    }
    return {
        attachmentId: record.attachmentId,
        mediaType: record.mediaType,
        bytes: record.bytes, width: record.width, height: record.height,
        ...(record.name === undefined ? {} : { name: record.name }),
    };
}
//# sourceMappingURL=agent-server.js.map