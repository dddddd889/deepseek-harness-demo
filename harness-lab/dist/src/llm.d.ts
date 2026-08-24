import type { ContentBlock, FinishReason, Message, StreamChunk, TokenUsage, ToolSchema } from './domain.ts';
export interface GenerateOptions {
    readonly provider: string;
    readonly model: string;
    readonly messages: readonly Message[];
    readonly system?: string;
    readonly tools?: readonly ToolSchema[];
    readonly temperature?: number;
    readonly maxTokens?: number;
}
export interface LlmProvider {
    /** 提供方只负责翻译线上的流；异常与取消由 大模型运行时 统一归一化。 */
    stream(options: GenerateOptions, signal: AbortSignal): AsyncIterable<StreamChunk>;
}
/** 提供方路由与错误边界；消费者永远看到一个终止帧，而不是裸异常。 */
export declare class LlmRuntime {
    #private;
    register(id: string, provider: LlmProvider): () => void;
    stream(options: GenerateOptions, signal: AbortSignal): AsyncGenerator<StreamChunk>;
}
/** 可脚本化提供方：测试和调试无需网络，也能精确控制每个数据块。 */
export declare class ScriptedLlmProvider implements LlmProvider {
    #private;
    constructor(chunks: readonly StreamChunk[], delayMs?: number);
    stream(_options: GenerateOptions, signal: AbortSignal): AsyncGenerator<StreamChunk>;
}
/** 将可交错的增量流确定性组装成最终助手消息。 */
export declare class BlockAssembler {
    #private;
    usage: TokenUsage | undefined;
    finish: FinishReason;
    push(chunk: StreamChunk): void;
    /** 只允许首次出现的 索引决定顺序，避免交错增量 改写块顺序。 */
    private ensure;
    blocks(): readonly ContentBlock[];
    message(provider: string, model: string): Message;
}
