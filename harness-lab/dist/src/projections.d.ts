import type { CallId, Message, SessionEvent } from './domain.ts';
export interface UsageTotals {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly cacheReadTokens: number;
    readonly cacheWriteTokens: number;
    readonly reasoningTokens: number;
}
export interface LifecycleView {
    readonly status: 'idle' | 'running';
    readonly turns: number;
    readonly steps: number;
    readonly openTurn: number | null;
    readonly openStep: number | null;
    readonly pendingToolCalls: readonly CallId[];
}
/** 重放 append/replace 得到当前模型可见事件；replace 边界必须仍在 surface 上。 */
export declare function deriveSurface(events: readonly SessionEvent[]): readonly SessionEvent[];
/** 从事实日志派生发给模型的消息历史；流式增量和纯 usage 消息不进入上下文。 */
export declare function deriveMessages(events: readonly SessionEvent[]): readonly Message[];
/** 按 turn/step 覆盖 usage 样本，避免 chunk 与最终 message 对同一次请求重复计费。 */
export declare function foldTokenUsage(events: readonly SessionEvent[]): UsageTotals;
/** 重放事件并校验 turn/step/tool 生命周期；错误携带 seq，便于定位损坏日志。 */
export declare function inspectLifecycle(events: readonly SessionEvent[]): LifecycleView;
