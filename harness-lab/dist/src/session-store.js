import { createHash } from 'node:crypto';
import { link, mkdir, open, readFile, realpath, rm, truncate } from 'node:fs/promises';
import { join } from 'node:path';
import { assertJsonValue, snapshotJson } from "./json.js";
import { Session } from "./session.js";
import { interruptedTurnClosers } from "./session-repair.js";
/** 逐事件写入带校验和的 JSONL 存储，提供刷盘、冷恢复修复与分叉。 */
export class JsonlSessionStore {
    root;
    #tracked = new Map();
    #ownedIds = new Set();
    constructor(root) { this.root = root; }
    static async open(root) {
        await mkdir(root, { recursive: true });
        return new JsonlSessionStore(await realpath(root));
    }
    async create(id, cwd, seed = [], parent) {
        validateId(id);
        const header = snapshotJson({
            id, format: 'harness-lab-jsonl', version: 1, cwd, createdAt: Date.now(),
            ...(parent === undefined ? {} : { parent }),
        });
        const session = new Session(seed);
        const path = this.pathFor(id);
        await this.materialize(path, header, session.events);
        await this.track(session, header, path);
        return { header, session };
    }
    async resume(id) {
        if (this.#ownedIds.has(id))
            throw new Error(`Session ${id} 已被此 Store 的 live 实例占用`);
        const inspected = await this.inspect(id, true);
        const session = new Session(inspected.events);
        await this.track(session, inspected.header, this.pathFor(id));
        return {
            header: inspected.header,
            session,
            repair: { repairedTornBytes: inspected.repairedTornBytes, syntheticClosers: inspected.syntheticClosers },
        };
    }
    /** 读取已提交前缀；完整坏行拒绝，只有缺少换行符的尾部可截断。 */
    async inspect(id, repair = false) {
        validateId(id);
        const path = this.pathFor(id);
        const bytes = await readFile(path);
        const newline = bytes.lastIndexOf(0x0A);
        if (newline < 0)
            throw new Error(`Session ${id} 缺少完整 header 行`);
        const committedEnd = newline + 1;
        const repairedTornBytes = bytes.length - committedEnd;
        const lines = bytes.subarray(0, committedEnd).toString('utf8').split('\n');
        lines.pop();
        const headerRecord = parseHeader(lines.shift(), id);
        const events = lines.map((line, index) => parseEvent(line, index));
        // 会话构造同时验证无损 JSON 与连续序号。
        const verified = new Session(events).events;
        const closers = repair ? interruptedTurnClosers(verified) : [];
        if (repair && (repairedTornBytes > 0 || closers.length > 0)) {
            if (repairedTornBytes > 0) {
                await truncate(path, committedEnd);
                const truncation = await open(path, 'r+');
                try {
                    await truncation.sync();
                }
                finally {
                    await truncation.close();
                }
            }
            if (closers.length > 0) {
                const handle = await open(path, 'a');
                try {
                    await handle.write(closers.map(eventLine).join(''));
                    await handle.sync();
                }
                finally {
                    await handle.close();
                }
            }
        }
        return {
            header: headerRecord.header,
            events: [...verified, ...closers],
            repairedTornBytes,
            syntheticClosers: closers.length,
        };
    }
    /** 从源事件前缀创建独立文件；切在 轮次中间时先合成中断闭合事件。 */
    async fork(sourceId, targetId, atSeq) {
        const source = await this.inspect(sourceId, true);
        const lastSeq = source.events.length - 1;
        const cut = atSeq ?? lastSeq;
        if (!Number.isInteger(cut) || cut < -1 || cut > lastSeq)
            throw new RangeError(`fork seq 越界：${cut}`);
        const prefix = source.events.slice(0, cut + 1);
        const balanced = [...prefix, ...interruptedTurnClosers(prefix)];
        return this.create(targetId, source.header.cwd, balanced, { sessionId: sourceId, seq: cut });
    }
    async flush(session) {
        const state = this.requireTracking(session);
        await state.pending;
        await state.handle.sync();
    }
    async close(session) {
        const state = this.requireTracking(session);
        state.unsubscribe();
        await this.flush(session);
        await state.handle.close();
        this.#tracked.delete(session);
        this.#ownedIds.delete(state.id);
    }
    async dispose() {
        const sessions = [...this.#tracked.keys()];
        const outcomes = await Promise.allSettled(sessions.map(session => this.close(session)));
        const failures = outcomes.filter(outcome => outcome.status === 'rejected');
        if (failures.length > 0)
            throw new AggregateError(failures.map(item => item.reason), '会话存储关闭失败');
    }
    pathFor(id) {
        validateId(id);
        return join(this.root, `${Buffer.from(id).toString('base64url')}.jsonl`);
    }
    async materialize(path, header, events) {
        const temporary = join(this.root, `.${crypto.randomUUID()}.tmp`);
        const handle = await open(temporary, 'wx');
        try {
            await handle.write(headerLine(header) + events.map(eventLine).join(''));
            await handle.sync();
        }
        finally {
            await handle.close();
        }
        try {
            // 硬链接发布 保证目标已存在时失败，绝不覆盖另一会话。
            await link(temporary, path);
            const directory = await open(this.root, 'r');
            try {
                await directory.sync();
            }
            finally {
                await directory.close();
            }
        }
        finally {
            await rm(temporary, { force: true });
        }
    }
    async track(session, header, path) {
        if (this.#ownedIds.has(header.id))
            throw new Error(`Session id 冲突：${header.id}`);
        const handle = await open(path, 'a');
        const state = {};
        Object.assign(state, {
            id: header.id,
            path,
            handle,
            nextSeq: session.events.length,
            pending: Promise.resolve(),
            unsubscribe: session.onAppend(event => {
                if (event.seq !== state.nextSeq) {
                    state.pending = Promise.reject(new Error(`持久化 seq 不连续：期望 ${state.nextSeq}，得到 ${event.seq}`));
                    return;
                }
                state.nextSeq += 1;
                state.pending = state.pending.then(() => state.handle.write(eventLine(event)).then(() => undefined));
            }),
        });
        this.#ownedIds.add(header.id);
        this.#tracked.set(session, state);
    }
    requireTracking(session) {
        const state = this.#tracked.get(session);
        if (!state)
            throw new Error('会话未由此存储跟踪');
        return state;
    }
}
/** 头部自身也带校验和，避免身份或谱系 被静默修改。 */
function headerLine(header) {
    const record = { kind: 'header', header, checksum: checksum(header) };
    return `${JSON.stringify(record)}\n`;
}
function eventLine(event) {
    const record = { kind: 'event', event, checksum: checksum(event) };
    return `${JSON.stringify(record)}\n`;
}
function checksum(value) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function parseHeader(line, expectedId) {
    if (!line)
        throw new Error('会话头部为空');
    const value = JSON.parse(line);
    assertJsonValue(value);
    if (value.kind !== 'header' || value.header?.format !== 'harness-lab-jsonl' || value.header.version !== 1) {
        throw new Error('不支持的 Session header/format 版本');
    }
    if (value.header.id !== expectedId)
        throw new Error(`Session header id 不匹配：${value.header.id}`);
    if (value.checksum !== checksum(value.header))
        throw new Error('会话头部校验和不匹配');
    return snapshotJson(value);
}
function parseEvent(line, index) {
    let value;
    try {
        value = JSON.parse(line);
    }
    catch {
        throw new Error(`Session 完整记录 JSON 损坏：line=${index + 2}`);
    }
    assertJsonValue(value);
    if (value.kind !== 'event' || value.checksum !== checksum(value.event)) {
        throw new Error(`Session event checksum 不匹配：line=${index + 2}`);
    }
    return snapshotJson(value.event);
}
function validateId(id) {
    if (!id)
        throw new TypeError('会话标识不能为空');
}
//# sourceMappingURL=session-store.js.map