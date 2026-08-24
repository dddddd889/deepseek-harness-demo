import type { SessionEvent } from './domain.ts';
/** 为冷恢复时未闭合的轮次生成确定性的工具、步骤与轮次闭合事件。 */
export declare function interruptedTurnClosers(events: readonly SessionEvent[]): SessionEvent[];
