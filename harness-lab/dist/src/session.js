import { snapshotJson } from "./json.js";
/** 最小 append-only Session；事件数组是后续持久化和投影的唯一事实源。 */
export class Session {
    #events = [];
    #listeners = new Set();
    constructor(seed = []) {
        for (let index = 0; index < seed.length; index += 1) {
            const event = seed[index];
            if (event?.seq !== index)
                throw new Error(`恢复事件 seq 不连续：期望 ${index}，得到 ${event?.seq}`);
            this.#events.push(snapshotJson(event));
        }
    }
    get events() {
        return this.#events;
    }
    /** 订阅提交后的事件；持久化层用它建立 write-behind 队列。 */
    onAppend(listener) {
        this.#listeners.add(listener);
        return () => this.#listeners.delete(listener);
    }
    /** 追加一条事件；seq 和 time 由 Session 统一生成。 */
    append(type, data, time = Date.now(), options = {}) {
        const event = snapshotJson({
            type,
            seq: this.#events.length,
            time,
            data,
            ...options,
        });
        // 泛型变体在此已经由 type/data 的同一 T 绑定；数组保存的是其联合上界。
        this.#events.push(event);
        for (const listener of this.#listeners)
            listener(event);
        return event;
    }
}
//# sourceMappingURL=session.js.map