/** 网络界面与权限服务 之间的一次性审批桥；决定第一写胜出。 */
export class InteractionBroker {
    #pending = new Map();
    answerer(sessionId) {
        return request => new Promise((resolve, reject) => {
            const key = `${sessionId}:${request.id}`;
            if (this.#pending.has(key)) {
                reject(new Error(`审批 id 重复：${request.id}`));
                return;
            }
            const aborted = () => {
                if (this.#pending.delete(key))
                    resolve('cancelled');
            };
            const record = {
                view: {
                    sessionId, id: request.id, toolName: request.toolName, callId: request.callId,
                    reason: request.reason, requestedMode: request.requestedMode, createdAt: Date.now(),
                }, resolve, cleanup: () => request.signal.removeEventListener('abort', aborted),
            };
            this.#pending.set(key, record);
            request.signal.addEventListener('abort', aborted, { once: true });
        });
    }
    list(sessionId) {
        return [...this.#pending.values()].map(record => record.view).filter(view => view.sessionId === sessionId);
    }
    answer(sessionId, id, outcome) {
        const key = `${sessionId}:${id}`;
        const record = this.#pending.get(key);
        if (record === undefined)
            return false;
        this.#pending.delete(key);
        record.cleanup();
        record.resolve(outcome);
        return true;
    }
    dispose() {
        for (const record of this.#pending.values()) {
            record.cleanup();
            record.resolve('cancelled');
        }
        this.#pending.clear();
    }
}
//# sourceMappingURL=interactions.js.map