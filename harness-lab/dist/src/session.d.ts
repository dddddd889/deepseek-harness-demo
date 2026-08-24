import type { SessionEvent, SessionEventMap, SessionEventType, SurfaceOp } from './domain.ts';
export interface AppendOptions {
    readonly ignorable?: true;
    readonly surfaceOp?: SurfaceOp;
    readonly sourceEventSeqs?: readonly number[];
}
/** 最小 append-only Session；事件数组是后续持久化和投影的唯一事实源。 */
export declare class Session {
    #private;
    constructor(seed?: readonly SessionEvent[]);
    get events(): readonly SessionEvent[];
    /** 订阅提交后的事件；持久化层用它建立 write-behind 队列。 */
    onAppend(listener: (event: SessionEvent) => void): () => void;
    /** 追加一条事件；seq 和 time 由 Session 统一生成。 */
    append<T extends SessionEventType>(type: T, data: SessionEventMap[T], time?: number, options?: AppendOptions): SessionEvent<T>;
}
