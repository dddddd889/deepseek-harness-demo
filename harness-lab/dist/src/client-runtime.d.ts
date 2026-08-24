import type { Message, SessionEvent } from './domain.ts';
import type { UsageTotals } from './projections.ts';
export interface ConversationView {
    readonly sessionId: string;
    readonly lastSeq: number;
    readonly messages: readonly Message[];
    readonly partialAssistantText: string;
    readonly running: boolean;
    readonly usage: UsageTotals;
}
/** 浏览器/SDK 共用投影：严格连续序号，绝不靠 界面 本地猜测补洞。 */
export declare class ClientProjection {
    #private;
    constructor(sessionId: string);
    get lastSeq(): number;
    get events(): readonly SessionEvent[];
    reset(events: readonly SessionEvent[]): void;
    apply(event: SessionEvent): void;
    view(): ConversationView;
}
export declare class AgentClientError extends Error {
    readonly code: string;
    readonly status: number;
    constructor(message: string, code: string, status: number);
}
export interface FollowCallbacks {
    onView?(view: ConversationView): void;
    onConnection?(state: 'connecting' | 'connected' | 'reconnecting'): void;
    onError?(error: unknown): void;
}
/** 网络客户端：RPC 请求标识由调用方稳定持有，断线后 SSE 从最后序号继续。 */
export declare class AgentClient {
    #private;
    constructor(baseURL: string, token: string | (() => string), fetchImpl?: typeof fetch);
    rpc<T>(method: string, params: Record<string, unknown>, requestId?: string, signal?: AbortSignal): Promise<T>;
    snapshot(sessionId: string, signal?: AbortSignal): Promise<readonly SessionEvent[]>;
    /** 一直追随到 取消信号触发；网络断开指数退避，协议缺口 先重新获取快照。 */
    follow(sessionId: string, projection: ClientProjection, signal: AbortSignal, callbacks?: FollowCallbacks): Promise<void>;
    events(sessionId: string, after: number, signal?: AbortSignal): AsyncGenerator<SessionEvent>;
}
