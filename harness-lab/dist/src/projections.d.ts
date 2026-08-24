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
/** 重放 追加与替换 得到当前模型可见事件；替换 边界必须仍在 模型可见面 上。 */
export declare function deriveSurface(events: readonly SessionEvent[]): readonly SessionEvent[];
/** 从事实日志派生发给模型的消息历史；流式增量和纯 用量 消息不进入上下文。 */
export declare function deriveMessages(events: readonly SessionEvent[]): readonly Message[];
/** 按 轮次与步骤 覆盖 用量 样本，避免 数据块 与最终 消息 对同一次请求重复计费。 */
export declare function foldTokenUsage(events: readonly SessionEvent[]): UsageTotals;
/** 重放事件并校验 轮次与步骤/工具 生命周期；错误携带 序号，便于定位损坏日志。 */
export declare function inspectLifecycle(events: readonly SessionEvent[]): LifecycleView;
