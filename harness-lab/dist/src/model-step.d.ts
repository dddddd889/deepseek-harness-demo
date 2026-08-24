import type { FinishReason, Message } from './domain.ts';
import { LlmRuntime } from './llm.ts';
import type { GenerateOptions } from './llm.ts';
import { Session } from './session.ts';
export interface ModelStepResult {
    readonly finish: FinishReason;
    readonly message?: Message;
}
/** 执行一次模型流：先逐帧落账，再组装最终消息；失败流不会伪造助手消息。 */
export declare function runModelStep(runtime: LlmRuntime, session: Session, turn: number, step: number, options: GenerateOptions, signal: AbortSignal): Promise<ModelStepResult>;
