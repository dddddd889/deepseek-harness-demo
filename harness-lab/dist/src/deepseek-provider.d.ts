import type { StreamChunk, TokenUsage } from './domain.ts';
import type { GenerateOptions, LlmProvider } from './llm.ts';
interface WireUsage {
    readonly prompt_tokens: number;
    readonly completion_tokens: number;
    readonly prompt_cache_hit_tokens?: number;
    readonly prompt_tokens_details?: {
        readonly cached_tokens?: number;
    };
    readonly completion_tokens_details?: {
        readonly reasoning_tokens?: number;
    };
}
export type DeepSeekFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export interface DeepSeekProviderOptions {
    /** 每次请求重新解析密钥，支持轮换；密钥绝不能进入会话事件。 */
    readonly apiKey: () => string | undefined;
    readonly baseURL?: string;
    readonly fetch?: DeepSeekFetch;
}
/** 最小 DeepSeek SSE 适配器；只负责 HTTP 线协议与框架流式数据块之间的翻译。 */
export declare class DeepSeekProvider implements LlmProvider {
    #private;
    constructor(options: DeepSeekProviderOptions);
    stream(options: GenerateOptions, signal: AbortSignal): AsyncGenerator<StreamChunk>;
}
/** DeepSeek 输入词元数包含缓存命中；转换成框架的互斥词元桶。 */
export declare function mapDeepSeekUsage(usage: WireUsage): TokenUsage;
/** 将 DeepSeek 数据载荷翻译为稳定的块协议，并保证用量位于结束帧之前。 */
export declare function translateDeepSeek(payloads: AsyncIterable<string>): AsyncGenerator<StreamChunk>;
export {};
