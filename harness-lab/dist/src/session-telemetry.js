/**
 * 将权威 会话日志 投影成 开放遥测日志风格记录。
 * 它只维护“已交给 日志接收端”的游标，不承诺远端已经收到，因此不能承担恢复职责。
 */
export class SessionTelemetry {
    #seenChunks = new Set();
    #sessionId;
    #session;
    #sink;
    #mode;
    #redact;
    #warn;
    #cursor;
    #unsubscribe;
    constructor(sessionId, session, sink, mode = 'disabled', redact = (record) => record, warn = () => { }) {
        this.#sessionId = sessionId;
        this.#session = session;
        this.#sink = sink;
        this.#mode = mode;
        this.#redact = redact;
        this.#warn = warn;
        this.#cursor = session.events.length - 1;
        for (const event of session.events)
            this.#track(event);
        this.#unsubscribe = session.onAppend((event) => this.#capture(event));
    }
    /** 关闭捕获并尽力排空后端；失败被隔离，不影响应用退出。 */
    async close() {
        this.#unsubscribe?.();
        this.#unsubscribe = undefined;
        try {
            await this.#sink.shutdown();
        }
        catch (error) {
            this.#warn(`telemetry shutdown failed: ${String(error)}`);
        }
    }
    #capture(event) {
        if (this.#mode === 'disabled')
            return;
        if (this.#mode === 'feedback-only' && event.type !== 'feedback/record')
            return;
        if (event.type === 'assistant/chunk') {
            const key = `${event.data.turn}:${event.data.step}`;
            if (this.#seenChunks.has(key))
                return;
            this.#seenChunks.add(key);
        }
        try {
            const record = this.#redact({
                channel: 'ledger',
                time: event.time,
                severity: severityOf(event),
                attributes: {
                    'session.id': this.#sessionId,
                    'event.type': event.type,
                    'event.seq': event.seq,
                },
                body: structuredClone(event.data),
            });
            this.#sink.emit(record);
            this.#cursor = event.seq;
        }
        catch (error) {
            this.#warn(`telemetry capture failed at seq ${event.seq}: ${String(error)}`);
        }
    }
    #track(event) {
        if (event.type === 'assistant/chunk')
            this.#seenChunks.add(`${event.data.turn}:${event.data.step}`);
    }
    get handedOffThrough() {
        return this.#cursor;
    }
}
/** 根据事件自身结果生成告警级别。 */
function severityOf(event) {
    if (event.type === 'tool/result' && event.data.error !== undefined)
        return 'error';
    if (event.type === 'turn/end' && event.data.reason.kind === 'error')
        return 'error';
    return 'info';
}
/** 测试与本地调试用的内存日志导出器。 */
export class MemoryTelemetrySink {
    records = [];
    #failAt;
    constructor(failAt) { this.#failAt = failAt; }
    emit(record) {
        if (this.#failAt === this.records.length)
            throw new Error('注入的导出失败');
        this.records.push(structuredClone(record));
    }
    async shutdown() { }
}
//# sourceMappingURL=session-telemetry.js.map