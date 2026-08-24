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
/** 最小 Inbox 驱动 Agent；一次 run 原子认领当时排队的全部用户消息。 */
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
    /** 用户输入只进入 Inbox；真正写入 Session 必须等某个 turn 成功认领。 */
    send(text: string): Message;
    /** 接受已通过 Host 边界验证的富内容；Inbox 仍只保存不可变 Message。 */
    sendContent(content: readonly ContentBlock[]): Message;
    onStatus(listener: (status: AgentStatus) => void): () => void;
    /** 取消当前模型读取；归一化后的 aborted finish 仍会进入 Session。 */
    cancel(reason?: Error): void;
    run(externalSignal?: AbortSignal): Promise<TurnResult | undefined>;
    /** 从已存在日志计算下一个 turn，使恢复后的 Agent 不会重用编号。 */
    private nextTurn;
    private setStatus;
}
