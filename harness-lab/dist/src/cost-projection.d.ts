import type { SessionEvent } from './domain.ts';
export interface ModelPrice {
    readonly provider: string;
    readonly model: string;
    readonly effectiveFrom: number;
    /** 每百万 token 的微美元价格；乘 token 后恰好得到皮美元。 */
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
 * cost 是 Session usage × 版本化价目表的派生投影，不写回事实日志。
 * 同一 turn/step 的最终 assistant/message 会覆盖流式 usage 样本，避免重复计费。
 */
export declare function projectCost(events: readonly SessionEvent[], book: PriceBook): CostProjection;
/** 将皮美元格式化为美元字符串，仅用于展示。 */
export declare function formatPicoUsd(picoUsd: bigint): string;
