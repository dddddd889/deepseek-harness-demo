import type { Message, SessionEvent } from './domain.ts';
import type { Session } from './session.ts';
export interface Summarizer {
    summarize(messages: readonly Message[], signal?: AbortSignal): Promise<string>;
}
export interface CompactResult {
    readonly id: string;
    readonly start: number;
    readonly end: number;
    readonly shadowedSeqs: readonly number[];
    readonly shadowedTokenCount: number;
    readonly summaryTokens: number;
}
/** 从头部选择区间，保留最近预算，并向前移动到完整 工具调用与结果边界。 */
export declare function selectCompactableRange(events: readonly SessionEvent[], retainTokens: number): {
    start: number;
    end: number;
} | null;
/** 摘要是日志事务：失败会闭合 边界事件，但绝不提交 替换记录。 */
export declare function compactRange(session: Session, range: {
    readonly start: number;
    readonly end: number;
}, summarizer: Summarizer, signal?: AbortSignal): Promise<CompactResult>;
