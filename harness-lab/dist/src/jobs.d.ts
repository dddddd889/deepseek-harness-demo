export type JobStatus = 'running' | 'stopping' | 'completed' | 'killed' | 'failed';
export interface JobOutcome {
    readonly status: 'completed' | 'killed' | 'failed';
    readonly detail?: string;
    readonly output?: string;
}
export interface JobHooks {
    cancel(reason?: string): void;
    readonly done: Promise<JobOutcome>;
    readOutput?(): string;
}
export interface JobStart {
    readonly kind: string;
    readonly label: string;
    readonly ownerSession?: string;
    readonly outputLimitBytes?: number;
    run(): JobHooks;
}
export interface JobSnapshot {
    readonly id: string;
    readonly kind: string;
    readonly label: string;
    readonly ownerSession?: string;
    readonly outputLimitBytes?: number;
    readonly status: JobStatus;
    readonly detail?: string;
    readonly startedAt: number;
    readonly finishedAt?: number;
    readonly reported: boolean;
}
export interface JobRead {
    readonly text: string;
    readonly snapshot: JobSnapshot;
}
export declare class JobError extends Error {
    readonly code: string;
    constructor(message: string, code: string);
}
/** 进程内 Job 控制面；执行资源仍归 producer，Registry 只拥有身份与生命周期。 */
export declare class LocalJobRegistry {
    #private;
    attachController(): () => void;
    start(spec: JobStart): string;
    list(callerSession?: string): readonly JobSnapshot[];
    get(id: string, callerSession?: string): JobSnapshot;
    read(id: string, callerSession?: string): JobRead;
    kill(id: string, callerSession?: string, reason?: string): 'requested' | 'already-finished';
    wait(id: string, timeoutMs: number, callerSession?: string, signal?: AbortSignal): Promise<JobSnapshot>;
    onDone(listener: (snapshot: JobSnapshot) => void | PromiseLike<void>): () => void;
    onChanged(listener: (ownerSession?: string) => void): () => void;
    /** owner 释放会停止并等待其所有 live jobs，然后删除这些 owner-private 记录。 */
    disposeOwner(ownerSession: string): Promise<void>;
    dispose(): Promise<void>;
}
