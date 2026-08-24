import type { SessionEvent } from './domain.ts';
import { Session } from './session.ts';
export interface SessionHeader {
    readonly id: string;
    readonly format: 'harness-lab-jsonl';
    readonly version: 1;
    readonly cwd: string;
    readonly createdAt: number;
    readonly parent?: {
        readonly sessionId: string;
        readonly seq: number;
    };
}
export interface SessionInspection {
    readonly header: SessionHeader;
    readonly events: readonly SessionEvent[];
    readonly repairedTornBytes: number;
    readonly syntheticClosers: number;
}
/** 逐事件 checksummed JSONL Store，提供 flush、冷恢复修复与 fork。 */
export declare class JsonlSessionStore {
    #private;
    readonly root: string;
    private constructor();
    static open(root: string): Promise<JsonlSessionStore>;
    create(id: string, cwd: string, seed?: readonly SessionEvent[], parent?: SessionHeader['parent']): Promise<{
        header: SessionHeader;
        session: Session;
    }>;
    resume(id: string): Promise<{
        header: SessionHeader;
        session: Session;
        repair: Omit<SessionInspection, 'header' | 'events'>;
    }>;
    /** 读取已提交前缀；完整坏行拒绝，只有 newline-less 尾部可截断。 */
    inspect(id: string, repair?: boolean): Promise<SessionInspection>;
    /** 从源事件前缀创建独立文件；切在 turn 中间时先合成 interrupted closers。 */
    fork(sourceId: string, targetId: string, atSeq?: number): Promise<{
        header: SessionHeader;
        session: Session;
    }>;
    flush(session: Session): Promise<void>;
    close(session: Session): Promise<void>;
    dispose(): Promise<void>;
    pathFor(id: string): string;
    private materialize;
    private track;
    private requireTracking;
}
