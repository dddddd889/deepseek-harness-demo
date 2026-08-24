import type { JsonValue } from './json.ts';
export type MessageId = string;
export type CallId = string;
export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';
export type ApprovalPolicy = 'ask' | 'never';
export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable';
export interface ToolEffect {
    readonly minimumMode: SandboxMode;
    readonly reason: string;
}
export interface ToolExecutionContext {
    readonly sandboxMode?: SandboxMode;
}
export interface TextBlock {
    readonly type: 'text';
    readonly text: string;
}
export interface ReasoningBlock {
    readonly type: 'reasoning';
    readonly text: string;
}
export interface ToolCallBlock {
    readonly type: 'tool-call';
    readonly id: CallId;
    readonly name: string;
    /** 保留模型产生的原始 JSON 字符串，解析属于工具管线。 */
    readonly arguments: string;
}
export interface ToolResultBlock {
    readonly type: 'tool-result';
    readonly toolCallId: CallId;
    readonly content: readonly ContentBlock[];
    readonly isError?: boolean;
}
export interface ImageAttachmentRef {
    readonly attachmentId: string;
    readonly mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
    readonly bytes: number;
    readonly width: number;
    readonly height: number;
    readonly name?: string;
}
export interface ImageBlock {
    readonly type: 'image';
    readonly attachment: ImageAttachmentRef;
}
export type ContentBlock = TextBlock | ReasoningBlock | ToolCallBlock | ToolResultBlock | ImageBlock;
export type ContentBlockType = ContentBlock['type'];
export type MessageSource = {
    readonly kind: 'user';
} | {
    readonly kind: 'plugin';
    readonly plugin: string;
} | {
    readonly kind: 'model';
    readonly provider: string;
    readonly model: string;
    readonly replayState?: JsonValue;
} | {
    readonly kind: 'tool';
    readonly callId: CallId;
};
export interface Message {
    readonly id: MessageId;
    readonly role: 'system' | 'user' | 'assistant';
    readonly content: readonly ContentBlock[];
    readonly source: MessageSource;
}
export interface TokenUsage {
    /** 未命中缓存的输入词元；缓存桶与它互斥，不能重复相加。 */
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly cacheReadTokens?: number;
    readonly cacheWriteTokens?: number;
    readonly reasoningTokens?: number;
}
export interface LlmFailure {
    readonly message: string;
    readonly code: string;
    readonly status?: number;
}
export type FinishReason = {
    readonly kind: 'stop';
} | {
    readonly kind: 'tool-calls';
} | {
    readonly kind: 'max-tokens';
} | {
    readonly kind: 'aborted';
    readonly failure: LlmFailure;
} | {
    readonly kind: 'error';
    readonly failure: LlmFailure;
};
export type StreamChunk = {
    readonly type: 'block-start';
    readonly index: number;
    readonly blockType: ContentBlockType;
} | {
    readonly type: 'text-delta';
    readonly index: number;
    readonly text: string;
} | {
    readonly type: 'reasoning-delta';
    readonly index: number;
    readonly text: string;
} | {
    readonly type: 'tool-call-delta';
    readonly index: number;
    readonly id: CallId;
    readonly name?: string;
    readonly argumentsDelta: string;
} | {
    readonly type: 'block-end';
    readonly index: number;
    readonly block: ContentBlock;
} | {
    readonly type: 'usage';
    readonly usage: TokenUsage;
} | {
    readonly type: 'finish';
    readonly reason: FinishReason;
};
/** 发送给模型的工具协议；执行函数不跨模型或持久化边界。 */
export interface ToolSchema {
    readonly name: string;
    readonly description: string;
    readonly parameters: Readonly<Record<string, JsonValue>>;
}
export interface ToolDefinition extends ToolSchema {
    execute(args: JsonValue, signal: AbortSignal, context?: ToolExecutionContext): Promise<JsonValue>;
    /** 只有显式返回 true 的调用才能与相邻安全调用重叠。 */
    isConcurrencySafe?(args: JsonValue): boolean;
    /** 将规范 JSON 输出投影成模型内容；省略时使用文本 JSON。 */
    render?(value: JsonValue): readonly ContentBlock[];
    /** 声明调用的最小文件权限；权限服务在执行之前判断。 */
    effect?(args: JsonValue): ToolEffect;
}
export interface RequestHeader {
    readonly provider: string;
    readonly model: string;
    readonly system?: string;
    readonly tools?: readonly ToolSchema[];
}
/** 事件如何改变模型可见面；替换只遮蔽历史，不删除事实日志。 */
export type SurfaceOp = 'append' | {
    readonly op: 'replace';
    readonly start: number;
    readonly end: number;
};
export type TurnEndReason = {
    readonly kind: 'completed';
} | {
    readonly kind: 'aborted';
    readonly reason: 'user' | 'disposed';
} | {
    readonly kind: 'blocked';
} | {
    readonly kind: 'error';
    readonly error: LlmFailure;
} | {
    readonly kind: 'max-tokens';
} | {
    readonly kind: 'interrupted';
};
export interface SessionEventMap {
    readonly 'turn/start': {
        readonly turn: number;
    };
    readonly 'turn/end': {
        readonly turn: number;
        readonly reason: TurnEndReason;
    };
    readonly 'step/start': {
        readonly turn: number;
        readonly step: number;
    };
    readonly 'step/end': {
        readonly turn: number;
        readonly step: number;
    };
    readonly 'user/message': Message;
    readonly 'assistant/chunk': {
        readonly turn: number;
        readonly step: number;
        readonly chunk: StreamChunk;
    };
    readonly 'assistant/message': {
        readonly turn: number;
        readonly step: number;
        readonly message: Message;
        readonly usage?: TokenUsage;
    };
    readonly 'tool/call': {
        readonly turn: number;
        readonly step: number;
        readonly callId: CallId;
        readonly name: string;
        readonly arguments: string;
    };
    readonly 'tool/result': {
        readonly turn: number;
        readonly step: number;
        readonly callId: CallId;
        readonly message: Message;
        readonly error?: {
            readonly name: string;
            readonly code: string;
        };
    };
    readonly 'request/header': {
        readonly header: RequestHeader;
        readonly reason: 'initial' | 'resume' | 'change';
    };
    readonly 'sandbox/mode': {
        readonly mode: SandboxMode;
        readonly source?: 'delegation';
    };
    readonly 'approval/policy': {
        readonly policy: ApprovalPolicy;
        readonly source?: 'delegation';
    };
    readonly 'approval/asked': {
        readonly id: string;
        readonly toolName: string;
        readonly callId?: CallId;
        readonly reason?: string;
    };
    readonly 'approval/decided': {
        readonly id: string;
        readonly outcome: ApprovalOutcome;
    };
    readonly 'compaction/start': {
        readonly id: string;
        readonly start: number;
        readonly end: number;
    };
    readonly 'compaction/summary': {
        readonly id: string;
        readonly shadowedTokenCount: number;
        readonly start: number;
        readonly end: number;
    };
    readonly 'compaction/end': {
        readonly id: string;
        readonly error?: string;
    };
    readonly 'feedback/record': {
        readonly score: 'up' | 'down';
        readonly comment?: string;
    };
}
export type SessionEventType = keyof SessionEventMap;
/** 根据事件类型生成真正的可辨识联合，分支判断后事件数据会同步收窄。 */
export type SessionEvent<T extends SessionEventType = SessionEventType> = {
    [K in T]: {
        readonly type: K;
        readonly seq: number;
        readonly time: number;
        readonly data: SessionEventMap[K];
        readonly ignorable?: true;
        readonly surfaceOp?: SurfaceOp;
        readonly sourceEventSeqs?: readonly number[];
    };
}[T];
/** 创建稳定身份、隔离且冻结的消息。 */
export declare function createMessage(input: Omit<Message, 'id'>): Message;
/** 生成可预测的穷尽检查错误，供协议消费者的 默认分支使用。 */
export declare function assertNever(value: never): never;
