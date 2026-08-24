import type { ContentBlock, Message, TurnEndReason } from './domain.ts';
import { LlmRuntime } from './llm.ts';
import { Session } from './session.ts';
import { ToolRegistry } from './tools.ts';
import { PermissionService } from './permissions.ts';
export type AgentStatus = 'idle' | 'running';
export interface AgentConfig {
    readonly provider: string;
    readonly model: string;
    readonly system?: string;
    readonly maxSteps?: number;
}
export interface TurnResult {
    readonly turn: number;
    readonly reason: TurnEndReason;
    readonly message?: Message;
}
/** 最小 收件箱驱动的智能体；一次运行会原子认领当时排队的全部用户消息。 */
export declare class HarnessAgent {
    #private;
    readonly session: Session;
    readonly runtime: LlmRuntime;
    readonly config: AgentConfig;
    readonly tools: ToolRegistry;
    readonly permissions: PermissionService | undefined;
    constructor(session: Session, runtime: LlmRuntime, config: AgentConfig, tools?: ToolRegistry, permissions?: PermissionService);
    get status(): AgentStatus;
    get pendingMessages(): number;
    /** 用户输入只进入 收件箱；真正写入会话 必须等某个 轮次成功认领。 */
    send(text: string): Message;
    /** 接受已通过宿主边界验证的富内容；收件箱 仍只保存不可变消息。 */
    sendContent(content: readonly ContentBlock[]): Message;
    onStatus(listener: (status: AgentStatus) => void): () => void;
    /** 取消当前模型读取；归一化后的 已取消终止帧 仍会进入会话。 */
    cancel(reason?: Error): void;
    run(externalSignal?: AbortSignal): Promise<TurnResult | undefined>;
    /** 从已存在日志计算下一个轮次，使恢复后的智能体 不会重用编号。 */
    private nextTurn;
    private setStatus;
}
