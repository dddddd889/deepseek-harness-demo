import type { SessionEvent } from './domain.ts';
/** 为冷恢复时的 open turn 生成确定性 tool/step/turn closers。 */
export declare function interruptedTurnClosers(events: readonly SessionEvent[]): SessionEvent[];
