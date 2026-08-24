export class JobError extends Error {
    code;
    constructor(message, code) { super(message); this.code = code; }
}
/** 进程内 Job 控制面；执行资源仍归 producer，Registry 只拥有身份与生命周期。 */
export class LocalJobRegistry {
    #records = new Map();
    #counters = new Map();
    #doneListeners = new Set();
    #changeListeners = new Set();
    #controllers = 0;
    #disposed = false;
    attachController() {
        if (this.#disposed)
            throw new JobError('Job Registry 已释放', 'JOB_DISPOSED');
        this.#controllers += 1;
        let active = true;
        return () => {
            if (!active)
                return;
            active = false;
            this.#controllers -= 1;
        };
    }
    start(spec) {
        if (this.#disposed)
            throw new JobError('Job Registry 已释放', 'JOB_DISPOSED');
        if (!/^[a-z][a-z0-9-]*$/.test(spec.kind))
            throw new JobError(`Job kind 无效：${spec.kind}`, 'JOB_INVALID');
        if (spec.label.trim() === '')
            throw new JobError('Job label 不能为空', 'JOB_INVALID');
        if (spec.ownerSession !== undefined && this.#controllers === 0) {
            throw new JobError('没有 controller 接管 owned job', 'JOB_NO_CONTROLLER');
        }
        if (spec.outputLimitBytes !== undefined && (!Number.isSafeInteger(spec.outputLimitBytes) || spec.outputLimitBytes <= 0)) {
            throw new JobError('outputLimitBytes 必须为正整数', 'JOB_INVALID');
        }
        // run 抛错时不消耗 id，也不发布半条记录。
        const hooks = spec.run();
        const next = (this.#counters.get(spec.kind) ?? 0) + 1;
        const id = `${spec.kind}-${next}`;
        const record = {
            id, kind: spec.kind, label: spec.label,
            ownerSession: spec.ownerSession,
            outputLimitBytes: spec.outputLimitBytes,
            startedAt: Date.now(), hooks,
            status: 'running', detail: undefined, output: undefined, finishedAt: undefined,
            reported: false, settled: false, waiters: new Set(),
        };
        this.#counters.set(spec.kind, next);
        this.#records.set(id, record);
        this.#changed(record.ownerSession);
        void Promise.resolve(hooks.done).then(outcome => this.#settle(record, outcome), error => this.#settle(record, { status: 'failed', detail: error instanceof Error ? error.message : String(error) }));
        return id;
    }
    list(callerSession) {
        return [...this.#records.values()]
            .filter(record => record.ownerSession === undefined || record.ownerSession === callerSession)
            .map(record => this.#snapshot(record));
    }
    get(id, callerSession) {
        return this.#snapshot(this.#authorized(id, callerSession));
    }
    read(id, callerSession) {
        const record = this.#authorized(id, callerSession);
        const raw = record.hooks.readOutput?.() ?? (record.settled ? record.output ?? '' : '');
        const text = this.#cap(raw, record.outputLimitBytes);
        if (record.settled)
            record.reported = true;
        return { text, snapshot: this.#snapshot(record) };
    }
    kill(id, callerSession, reason) {
        const record = this.#authorized(id, callerSession);
        if (record.settled) {
            record.reported = true;
            return 'already-finished';
        }
        // cancel 抛错时状态保持 running，调用方能明确重试或升级。
        record.hooks.cancel(reason);
        record.status = 'stopping';
        record.reported = true;
        this.#changed(record.ownerSession);
        return 'requested';
    }
    async wait(id, timeoutMs, callerSession, signal) {
        if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
            throw new JobError('wait timeout 必须为正数', 'JOB_INVALID');
        const record = this.#authorized(id, callerSession);
        if (record.settled)
            return this.#snapshot(record);
        await new Promise((resolve, reject) => {
            let timer;
            const done = () => { cleanup(); resolve(); };
            const aborted = () => { cleanup(); reject(signal?.reason ?? new Error('wait aborted')); };
            const cleanup = () => {
                clearTimeout(timer);
                record.waiters.delete(done);
                signal?.removeEventListener('abort', aborted);
            };
            timer = setTimeout(done, timeoutMs);
            record.waiters.add(done);
            signal?.addEventListener('abort', aborted, { once: true });
            if (signal?.aborted === true)
                aborted();
        });
        return this.#snapshot(record);
    }
    onDone(listener) {
        this.#doneListeners.add(listener);
        return () => this.#doneListeners.delete(listener);
    }
    onChanged(listener) {
        this.#changeListeners.add(listener);
        return () => this.#changeListeners.delete(listener);
    }
    /** owner 释放会停止并等待其所有 live jobs，然后删除这些 owner-private 记录。 */
    async disposeOwner(ownerSession) {
        const owned = [...this.#records.values()].filter(record => record.ownerSession === ownerSession);
        for (const record of owned) {
            record.reported = true;
            if (!record.settled) {
                try {
                    record.hooks.cancel('owner disposed');
                    record.status = 'stopping';
                }
                catch (error) {
                    this.#settle(record, { status: 'failed', detail: `cleanup cancel failed: ${String(error)}` });
                }
            }
        }
        await Promise.all(owned.map(async (record) => {
            if (!record.settled)
                await this.wait(record.id, 30_000, ownerSession);
            this.#records.delete(record.id);
        }));
        this.#changed(ownerSession);
    }
    async dispose() {
        if (this.#disposed)
            return;
        this.#disposed = true;
        const live = [...this.#records.values()].filter(record => !record.settled);
        for (const record of live) {
            record.reported = true;
            try {
                record.hooks.cancel('registry disposed');
                record.status = 'stopping';
            }
            catch (error) {
                this.#settle(record, { status: 'failed', detail: `cleanup cancel failed: ${String(error)}` });
            }
        }
        await Promise.all(live.map(record => record.settled ? Promise.resolve() : record.hooks.done.catch(() => undefined)));
        this.#records.clear();
        this.#doneListeners.clear();
        this.#changeListeners.clear();
    }
    #authorized(id, callerSession) {
        const record = this.#records.get(id);
        // 不区分 unknown/foreign，防止可预测 id 成为跨 owner 枚举侧信道。
        if (record === undefined || (record.ownerSession !== undefined && record.ownerSession !== callerSession)) {
            throw new JobError(`Job 不存在或无权访问：${id}`, 'JOB_NOT_FOUND');
        }
        return record;
    }
    #settle(record, outcome) {
        if (record.settled)
            return;
        record.settled = true;
        record.status = outcome.status;
        record.detail = outcome.detail;
        record.output = outcome.output;
        record.finishedAt = Date.now();
        for (const wake of record.waiters)
            wake();
        this.#changed(record.ownerSession);
        const snapshot = this.#snapshot(record);
        for (const listener of this.#doneListeners) {
            try {
                Promise.resolve(listener(snapshot)).catch(() => undefined);
            }
            catch { /* listener 隔离 */ }
        }
    }
    #snapshot(record) {
        return {
            id: record.id, kind: record.kind, label: record.label, status: record.status,
            startedAt: record.startedAt, reported: record.reported,
            ...record.ownerSession === undefined ? {} : { ownerSession: record.ownerSession },
            ...record.outputLimitBytes === undefined ? {} : { outputLimitBytes: record.outputLimitBytes },
            ...record.detail === undefined ? {} : { detail: record.detail },
            ...record.finishedAt === undefined ? {} : { finishedAt: record.finishedAt },
        };
    }
    #changed(ownerSession) {
        for (const listener of this.#changeListeners) {
            try {
                listener(ownerSession);
            }
            catch { /* observer 隔离 */ }
        }
    }
    #cap(text, limit) {
        if (limit === undefined || Buffer.byteLength(text, 'utf8') <= limit)
            return text;
        let end = Math.min(text.length, limit);
        while (end > 0 && Buffer.byteLength(text.slice(0, end), 'utf8') > limit)
            end -= 1;
        return `${text.slice(0, end)}\n[output truncated]`;
    }
}
//# sourceMappingURL=jobs.js.map