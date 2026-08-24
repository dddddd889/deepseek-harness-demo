import type { ApprovalAnswerer } from './permissions.ts';
import type { ApprovalOutcome } from './domain.ts';
export interface PendingApproval {
    readonly sessionId: string;
    readonly id: string;
    readonly toolName: string;
    readonly callId: string;
    readonly reason: string;
    readonly requestedMode: string;
    readonly createdAt: number;
}
/** 网络 UI 与 PermissionService 之间的一次性审批桥；决定第一写胜出。 */
export declare class InteractionBroker {
    #private;
    answerer(sessionId: string): ApprovalAnswerer;
    list(sessionId: string): readonly PendingApproval[];
    answer(sessionId: string, id: string, outcome: ApprovalOutcome): boolean;
    dispose(): void;
}
