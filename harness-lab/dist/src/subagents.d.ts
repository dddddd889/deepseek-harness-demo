import type { ContentBlock } from './domain.ts';
import type { LocalJobRegistry } from './jobs.ts';
export type SubagentStopReason = 'completed' | 'aborted' | 'error' | 'max-tokens' | 'refusal';
export interface SubagentResult {
    readonly output: readonly ContentBlock[];
    readonly structured?: unknown;
    readonly stopReason: SubagentStopReason;
}
export interface SubagentCapabilities {
    readonly outputSchema: boolean;
    readonly depthLimit: boolean;
    readonly toolFilter: boolean;
    readonly persona: boolean;
}
export interface SubagentStartRequest {
    readonly label?: string;
    readonly prompt: readonly ContentBlock[];
    readonly parentSession: string;
    readonly parentDepth: number;
    readonly signal: AbortSignal;
    readonly outputSchema?: Readonly<Record<string, unknown>>;
    readonly maxDepth?: number;
    readonly toolFilter?: {
        readonly allow?: readonly string[];
        readonly deny?: readonly string[];
    };
    readonly persona?: string;
}
export interface ProviderRun {
    readonly id: string;
    readonly local: boolean;
    readonly result: Promise<SubagentResult>;
    cancel(reason?: string): void;
    dispose(): Promise<void>;
}
export interface SubagentProvider {
    readonly name: string;
    readonly capabilities: SubagentCapabilities;
    available(): boolean;
    start(request: SubagentStartRequest & {
        readonly depth: number;
    }): Promise<ProviderRun>;
}
export interface SubagentRun {
    readonly runId: string;
    readonly id: string;
    readonly provider: string;
    readonly local: boolean;
    readonly result: Promise<SubagentResult>;
    cancel(reason?: string): void;
    dispose(): Promise<void>;
}
export type SubagentLifecycleEvent = {
    readonly type: 'start';
    readonly runId: string;
    readonly id: string;
    readonly provider: string;
    readonly parentSession: string;
    readonly local: boolean;
} | {
    readonly type: 'end';
    readonly runId: string;
    readonly id: string;
    readonly provider: string;
    readonly parentSession: string;
    readonly local: boolean;
    readonly stopReason: SubagentStopReason;
};
export declare class SubagentError extends Error {
    readonly code: string;
    constructor(message: string, code: string);
}
/** 子 Agent 控制面：选择 provider、前置能力校验、配对生命周期与资源收敛。 */
export declare class SubagentRuntime {
    #private;
    register(provider: SubagentProvider): () => void;
    onLifecycle(listener: (event: SubagentLifecycleEvent) => void): () => void;
    active(): readonly SubagentRun[];
    start(providerName: string | undefined, request: SubagentStartRequest): Promise<SubagentRun>;
    /** 把一次 delegation 包成 owner-private 后台 Job。 */
    startJob(jobs: LocalJobRegistry, providerName: string | undefined, request: Omit<SubagentStartRequest, 'signal'>): string;
    dispose(): Promise<void>;
}
/** 可注入 execute 的本地 provider，便于断点调试完整生命周期。 */
export declare class InProcessSubagentProvider implements SubagentProvider {
    #private;
    readonly name: string;
    readonly capabilities: SubagentCapabilities;
    constructor(name: string, execute: (request: SubagentStartRequest & {
        readonly depth: number;
    }, signal: AbortSignal) => Promise<SubagentResult>);
    available(): boolean;
    start(request: SubagentStartRequest & {
        readonly depth: number;
    }): Promise<ProviderRun>;
}
