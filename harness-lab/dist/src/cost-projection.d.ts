import type { SessionEvent } from './domain.ts';
export interface ModelPrice {
    readonly provider: string;
    readonly model: string;
    readonly effectiveFrom: number;
    /** 每百万词元的微美元价格；乘以词元数后恰好得到皮美元。 */
    readonly inputMicroUsdPerMillion: number;
    readonly outputMicroUsdPerMillion: number;
    readonly cacheReadMicroUsdPerMillion?: number;
    readonly cacheWriteMicroUsdPerMillion?: number;
}
export interface PriceBook {
    readonly version: string;
    readonly prices: readonly ModelPrice[];
}
export interface CostProjection {
    readonly priceBookVersion: string;
    readonly picoUsd: bigint;
    readonly pricedSteps: number;
    readonly unpricedSteps: readonly string[];
}
/**
 * 成本是会话用量 × 版本化价目表的派生投影，不写回事实日志。
 * 同一轮次与步骤的最终助手消息会覆盖流式用量样本，避免重复计费。
 */
export declare function projectCost(events: readonly SessionEvent[], book: PriceBook): CostProjection;
/** 将皮美元格式化为美元字符串，仅用于展示。 */
export declare function formatPicoUsd(picoUsd: bigint): string;
