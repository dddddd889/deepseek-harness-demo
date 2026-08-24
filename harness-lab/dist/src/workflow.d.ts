import type { JsonValue } from './json.ts';
import type { SubagentRuntime } from './subagents.ts';
export interface WorkflowMeta {
    readonly name: string;
    readonly description: string;
    readonly phases?: readonly {
        readonly title: string;
        readonly detail?: string;
    }[];
}
export interface WorkflowRequest {
    readonly script: string;
    readonly meta: WorkflowMeta;
    readonly args?: JsonValue;
    readonly subagentProvider?: string;
    readonly maxTotalAgents?: number;
    readonly maxConcurrentAgents?: number;
    readonly cancelGraceMs?: number;
    readonly parentSession: string;
    readonly parentDepth: number;
    readonly signal?: AbortSignal;
}
export interface WorkflowResult {
    readonly value: JsonValue;
    readonly stopReason: 'completed' | 'cancelled' | 'error';
    readonly error?: string;
    readonly agentsStarted: number;
}
export interface WorkflowRun {
    readonly id: string;
    readonly result: Promise<WorkflowResult>;
    cancel(reason?: string): void;
}
export type WorkflowEvent = {
    readonly type: 'start';
    readonly id: string;
    readonly meta: WorkflowMeta;
} | {
    readonly type: 'phase';
    readonly id: string;
    readonly title: string;
} | {
    readonly type: 'log';
    readonly id: string;
    readonly message: string;
} | {
    readonly type: 'agent-start';
    readonly id: string;
    readonly seq: number;
    readonly childId: string;
    readonly label: string;
    readonly phase?: string;
} | {
    readonly type: 'agent-end';
    readonly id: string;
    readonly seq: number;
    readonly childId: string;
    readonly label: string;
    readonly outcome: 'completed' | 'failed' | 'cancelled';
    readonly phase?: string;
} | {
    readonly type: 'end';
    readonly id: string;
    readonly result: Omit<WorkflowResult, 'value'>;
};
/** Worker-thread Workflow：脚本动态 fan-out，Host 掌握子 Agent 与预算。 */
export declare class WorkflowEngine {
    #private;
    constructor(subagents: SubagentRuntime);
    onEvent(listener: (event: WorkflowEvent) => void): () => void;
    start(request: WorkflowRequest): WorkflowRun;
}
