import type { ApprovalOutcome, ApprovalPolicy, SandboxMode, SessionEvent, ToolCallBlock, ToolEffect } from './domain.ts';
import type { JsonValue } from './json.ts';
import { Session } from './session.ts';
export type ApprovalAnswerer = (request: {
    readonly id: string;
    readonly toolName: string;
    readonly callId: string;
    readonly reason: string;
    readonly requestedMode: SandboxMode;
    readonly signal: AbortSignal;
}) => Promise<ApprovalOutcome>;
export interface PermissionConfig {
    readonly defaultMode?: SandboxMode;
    readonly defaultApprovalPolicy?: ApprovalPolicy;
    readonly answerer?: ApprovalAnswerer;
}
export declare class PermissionError extends Error {
    readonly code: string;
    constructor(message: string, code: string);
}
/** 会话日志驱动的权限服务；批准只对本次授权返回值有效。 */
export declare class PermissionService {
    #private;
    constructor(config?: PermissionConfig);
    mode(session: Session): SandboxMode;
    approvalPolicy(session: Session): ApprovalPolicy;
    setMode(session: Session, mode: SandboxMode): void;
    setApprovalPolicy(session: Session, policy: ApprovalPolicy): void;
    /** 校验当前权限或执行一次严格升级审批；任何失败都发生在工具执行体 之前。 */
    authorize(session: Session, call: ToolCallBlock, args: JsonValue, effect: ToolEffect, signal: AbortSignal): Promise<SandboxMode>;
    private requestApproval;
}
/** 重放审批审计，验证 询问与决定事件 一一配对。 */
export declare function inspectApprovalAudit(events: readonly SessionEvent[]): {
    readonly pending: readonly string[];
    readonly decisions: number;
};
