import { HeadlessHost } from './headless-host.ts';
import type { LocalAttachmentStore } from './attachment-store.ts';
import type { InteractionBroker } from './interactions.ts';
export interface AgentServerOptions {
    readonly host?: string;
    readonly port?: number;
    readonly authToken: string;
    readonly maxRequestBytes?: number;
    readonly maxSseQueueBytes?: number;
    readonly heartbeatMs?: number;
    readonly idempotencyEntries?: number;
    readonly webRoot?: string;
    readonly attachments?: LocalAttachmentStore;
    readonly interactions?: InteractionBroker;
}
export declare class AgentServerError extends Error {
    readonly code: string;
    readonly status: number;
    readonly details: unknown;
    constructor(message: string, code: string, status?: number, details?: unknown);
}
/** 真正的智能体服务：HTTP RPC 控制面 + SSE 会话事件数据面。 */
export declare class AgentServer {
    #private;
    constructor(host: HeadlessHost, options: AgentServerOptions);
    listen(): Promise<{
        readonly host: string;
        readonly port: number;
        readonly url: string;
    }>;
    close(): Promise<void>;
}
