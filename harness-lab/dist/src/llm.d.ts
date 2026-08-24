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
    /** Provider 只负责翻译线上的流；异常与取消由 LlmRuntime 统一归一化。 */
    stream(options: GenerateOptions, signal: AbortSignal): AsyncIterable<StreamChunk>;
}
/** Provider 路由与错误边界；消费者永远看到一个终止 finish，而不是裸异常。 */
export declare class LlmRuntime {
    #private;
    register(id: string, provider: LlmProvider): () => void;
    stream(options: GenerateOptions, signal: AbortSignal): AsyncGenerator<StreamChunk>;
}
/** 可脚本化 Provider：测试和调试无需网络，也能精确控制每个 chunk。 */
export declare class ScriptedLlmProvider implements LlmProvider {
    #private;
    constructor(chunks: readonly StreamChunk[], delayMs?: number);
    stream(_options: GenerateOptions, signal: AbortSignal): AsyncGenerator<StreamChunk>;
}
/** 将可交错的 delta 流确定性组装成最终 assistant message。 */
export declare class BlockAssembler {
    #private;
    usage: TokenUsage | undefined;
    finish: FinishReason;
    push(chunk: StreamChunk): void;
    /** 只允许首次出现的 index 决定顺序，避免交错 delta 改写块顺序。 */
    private ensure;
    blocks(): readonly ContentBlock[];
    message(provider: string, model: string): Message;
}
