import type { ContentBlock, Message, SessionEvent } from './domain.ts';
export interface PricedSurfaceNode {
    readonly seq: number;
    readonly tokens: number;
}
export interface TokenMeasurement {
    readonly nodes: readonly PricedSurfaceNode[];
    readonly messageTokens: number;
    readonly systemTokens: number;
    readonly toolsTokens: number;
    readonly heuristicPromptTokens: number;
}
export interface ContextPressure {
    /** 最近一次提供方 实测的 输入，不含输出。 */
    readonly pressureTokens?: number;
    /** 提供方锚点加 模型可见面变化量，表示下一次请求。 */
    readonly projectedTokens?: number;
    readonly contextWindow?: number;
    readonly ratio?: number;
}
/** 固定密度估算器只用于相对决策；账单必须使用 提供方用量。 */
export declare function estimateText(text: string): number;
/** 估算一个内容块，并给协议封装留出固定开销。 */
export declare function estimateBlock(block: ContentBlock): number;
/** 估算模型消息价格；角色和消息封装 也占 词元。 */
export declare function estimateMessage(message: Message): number;
/** 对当前 模型可见面 定价，同时把 系统提示与工具模式 分桶展示。 */
export declare function measureTokens(events: readonly SessionEvent[]): TokenMeasurement;
/** 提供方用量 为锚点；锚点之后只用 模型可见面的估算增减修正下一请求压力。 */
export declare function projectContextPressure(events: readonly SessionEvent[], contextWindow?: number): ContextPressure;
