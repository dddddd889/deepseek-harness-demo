import { deriveMessages, foldTokenUsage, inspectLifecycle } from "./projections.js";
/** 浏览器/SDK 共用投影：严格连续序号，绝不靠 界面 本地猜测补洞。 */
export class ClientProjection {
    #sessionId;
    #events = [];
    #partial = '';
    constructor(sessionId) { this.#sessionId = sessionId; }
    get lastSeq() { return this.#events.at(-1)?.seq ?? -1; }
    get events() { return this.#events; }
    reset(events) {
        this.#events.length = 0;
        this.#partial = '';
        for (const event of events)
            this.apply(event);
    }
    apply(event) {
        const expected = this.lastSeq + 1;
        if (event.seq < expected)
            return; // SSE 重放与快照重叠时幂等忽略。
        if (event.seq !== expected)
            throw new Error(`CLIENT_EVENT_GAP：期望 seq=${expected}，收到 ${event.seq}`);
        this.#events.push(event);
        if (event.type === 'assistant/chunk') {
            const chunk = event.data.chunk;
            if (chunk.type === 'text-delta')
                this.#partial += chunk.text;
        }
        if (event.type === 'assistant/message' || event.type === 'turn/end')
            this.#partial = '';
    }
    view() {
        let running = false;
        try {
            running = inspectLifecycle(this.#events).status === 'running';
        }
        catch {
            running = this.#events.some(event => event.type === 'turn/start') && this.#events.at(-1)?.type !== 'turn/end';
        }
        return {
            sessionId: this.#sessionId, lastSeq: this.lastSeq,
            messages: deriveMessages(this.#events), partialAssistantText: this.#partial,
            running, usage: foldTokenUsage(this.#events),
        };
    }
}
export class AgentClientError extends Error {
    code;
    status;
    constructor(message, code, status) { super(message); this.code = code; this.status = status; }
}
/** 网络客户端：RPC 请求标识由调用方稳定持有，断线后 SSE 从最后序号继续。 */
export class AgentClient {
    #baseURL;
    #token;
    #fetch;
    constructor(baseURL, token, fetchImpl = fetch) {
        this.#baseURL = baseURL.replace(/\/$/, '');
        this.#token = typeof token === 'string' ? () => token : token;
        this.#fetch = fetchImpl;
    }
    async rpc(method, params, requestId = crypto.randomUUID(), signal) {
        const response = await this.#fetch(`${this.#baseURL}/rpc`, {
            method: 'POST', ...(signal === undefined ? {} : { signal }),
            headers: { authorization: `Bearer ${this.#token()}`, 'content-type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }),
        });
        const envelope = await response.json();
        if (envelope.error !== undefined)
            throw new AgentClientError(envelope.error.message, envelope.error.code, response.status);
        if (envelope.result === undefined)
            throw new AgentClientError('RPC 响应缺少结果字段', 'INVALID_RESPONSE', response.status);
        return envelope.result;
    }
    async snapshot(sessionId, signal) {
        const result = await this.rpc('session.snapshot', { sessionId }, crypto.randomUUID(), signal);
        return result.events;
    }
    /** 一直追随到 取消信号触发；网络断开指数退避，协议缺口 先重新获取快照。 */
    async follow(sessionId, projection, signal, callbacks = {}) {
        callbacks.onConnection?.('connecting');
        projection.reset(await this.snapshot(sessionId, signal));
        callbacks.onView?.(projection.view());
        let delay = 50;
        while (!signal.aborted) {
            try {
                callbacks.onConnection?.(delay === 50 ? 'connected' : 'reconnecting');
                for await (const event of this.events(sessionId, projection.lastSeq, signal)) {
                    try {
                        projection.apply(event);
                    }
                    catch (error) {
                        projection.reset(await this.snapshot(sessionId, signal));
                        callbacks.onError?.(error);
                    }
                    callbacks.onView?.(projection.view());
                    delay = 50;
                }
                if (!signal.aborted)
                    throw new Error('SSE 连接意外结束');
            }
            catch (error) {
                if (signal.aborted)
                    return;
                callbacks.onError?.(error);
                callbacks.onConnection?.('reconnecting');
                await abortableDelay(delay, signal);
                delay = Math.min(delay * 2, 2_000);
            }
        }
    }
    async *events(sessionId, after, signal) {
        const response = await this.#fetch(`${this.#baseURL}/events?sessionId=${encodeURIComponent(sessionId)}&after=${after}`, {
            headers: { authorization: `Bearer ${this.#token()}` }, ...(signal === undefined ? {} : { signal }),
        });
        if (!response.ok || response.body === null)
            throw new AgentClientError(`SSE 请求失败，HTTP 状态码 ${response.status}`, 'EVENT_STREAM_FAILED', response.status);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        try {
            while (true) {
                const chunk = await reader.read();
                if (chunk.done)
                    break;
                buffer += decoder.decode(chunk.value, { stream: true }).replaceAll('\r\n', '\n');
                let boundary;
                while ((boundary = buffer.indexOf('\n\n')) >= 0) {
                    const frame = buffer.slice(0, boundary);
                    buffer = buffer.slice(boundary + 2);
                    const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
                    if (data === '')
                        continue;
                    const value = JSON.parse(data);
                    yield value;
                }
            }
        }
        finally {
            // 网络请求取消 已拥有底层连接关闭；不能让某些实现迟缓的 取消操作 阻塞重连/退出。
            void reader.cancel().catch(() => undefined);
        }
    }
}
function abortableDelay(ms, signal) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, ms);
        signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
    });
}
//# sourceMappingURL=client-runtime.js.map