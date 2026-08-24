import { Session } from "./session.js";
export class PermissionError extends Error {
    code;
    constructor(message, code) {
        super(message);
        this.name = 'PermissionError';
        this.code = code;
    }
}
/** 会话日志驱动的权限服务；批准只对本次授权返回值有效。 */
export class PermissionService {
    #defaultMode;
    #defaultApprovalPolicy;
    #answerer;
    constructor(config = {}) {
        this.#defaultMode = config.defaultMode ?? 'read-only';
        this.#defaultApprovalPolicy = config.defaultApprovalPolicy ?? 'ask';
        this.#answerer = config.answerer;
    }
    mode(session) {
        return lastEventValue(session.events, 'sandbox/mode', event => event.data.mode) ?? this.#defaultMode;
    }
    approvalPolicy(session) {
        return lastEventValue(session.events, 'approval/policy', event => event.data.policy) ?? this.#defaultApprovalPolicy;
    }
    setMode(session, mode) { session.append('sandbox/mode', { mode }); }
    setApprovalPolicy(session, policy) { session.append('approval/policy', { policy }); }
    /** 校验当前权限或执行一次严格升级审批；任何失败都发生在工具执行体 之前。 */
    async authorize(session, call, args, effect, signal) {
        const effective = this.mode(session);
        const requested = stringField(args, 'sandbox_permissions');
        const justification = stringField(args, 'justification');
        validateEscalationPair(requested, justification);
        if (requested === undefined) {
            if (rank(effective) >= rank(effect.minimumMode))
                return effective;
            throw new PermissionError(`[sandbox: file access denied under ${effective} mode] ${effect.reason}; `
                + '可用更宽模式重试，并同时提供 sandbox_permissions 与 justification', 'SANDBOX_DENIED');
        }
        if (!isSandboxMode(requested))
            throw new PermissionError(`未知沙箱权限：${requested}`, 'INVALID_ESCALATION');
        if (rank(requested) <= rank(effective)) {
            throw new PermissionError(`升级目标 ${requested} 不比当前 ${effective} 更宽`, 'INVALID_ESCALATION');
        }
        if (rank(requested) < rank(effect.minimumMode)) {
            throw new PermissionError(`升级目标 ${requested} 仍不足以执行：需要 ${effect.minimumMode}`, 'INVALID_ESCALATION');
        }
        const outcome = await this.requestApproval(session, call, requested, justification ?? '', signal);
        if (outcome === 'allowed-once')
            return requested;
        if (outcome === 'cancelled')
            throw new PermissionError('审批已取消', 'APPROVAL_CANCELLED');
        if (outcome === 'unavailable')
            throw new PermissionError('没有可用审批通道', 'APPROVAL_UNAVAILABLE');
        throw new PermissionError('用户拒绝权限升级', 'APPROVAL_REJECTED');
    }
    async requestApproval(session, call, requestedMode, justification, signal) {
        if (!hasOpenTurn(session.events))
            throw new PermissionError('审批必须发生在未闭合的轮次内', 'APPROVAL_OUTSIDE_TURN');
        const id = crypto.randomUUID();
        const reason = `escalate sandbox to ${requestedMode}: ${justification}`;
        session.append('approval/asked', { id, toolName: call.name, callId: call.id, reason });
        let outcome;
        if (signal.aborted)
            outcome = 'cancelled';
        else if (this.approvalPolicy(session) === 'never')
            outcome = 'rejected';
        else if (!this.#answerer)
            outcome = 'unavailable';
        else
            outcome = await raceAnswer(this.#answerer({ id, toolName: call.name, callId: call.id, reason, requestedMode, signal }), signal);
        session.append('approval/decided', { id, outcome });
        return outcome;
    }
}
/** 重放审批审计，验证 询问与决定事件 一一配对。 */
export function inspectApprovalAudit(events) {
    const pending = new Set();
    let decisions = 0;
    let openTurn = false;
    for (const event of events) {
        if (event.type === 'turn/start')
            openTurn = true;
        if (event.type === 'turn/end')
            openTurn = false;
        if (event.type === 'approval/asked') {
            if (!openTurn)
                throw new Error(`审批 asked 位于 turn 外：seq=${event.seq}`);
            if (!event.data.toolName)
                throw new Error(`审批工具名为空：seq=${event.seq}`);
            if (pending.has(event.data.id))
                throw new Error(`审批 id 重复：${event.data.id}`);
            pending.add(event.data.id);
        }
        if (event.type === 'approval/decided') {
            if (!openTurn || !pending.delete(event.data.id))
                throw new Error(`审批 decided 无匹配 asked：seq=${event.seq}`);
            decisions += 1;
        }
    }
    return { pending: [...pending], decisions };
}
/** 与取消竞速；取消胜出后丢弃迟到回答。 */
async function raceAnswer(answer, signal) {
    if (signal.aborted)
        return 'cancelled';
    return new Promise(resolve => {
        const cancel = () => { signal.removeEventListener('abort', cancel); resolve('cancelled'); };
        signal.addEventListener('abort', cancel, { once: true });
        void answer.then(outcome => { signal.removeEventListener('abort', cancel); resolve(isOutcome(outcome) ? outcome : 'unavailable'); }, () => { signal.removeEventListener('abort', cancel); resolve('unavailable'); });
    });
}
/** 从对象参数读取可选字符串。 */
function stringField(args, name) {
    if (typeof args !== 'object' || args === null || Array.isArray(args))
        return undefined;
    const value = args[name];
    return typeof value === 'string' ? value : undefined;
}
/** 数据模式难以表达的成对约束。 */
function validateEscalationPair(mode, justification) {
    if ((mode === undefined) !== (justification === undefined) || justification?.trim().length === 0) {
        throw new PermissionError('沙箱权限与非空申请理由必须同时提供', 'INVALID_ESCALATION');
    }
}
/** 权限模式严格序。 */
function rank(mode) {
    if (mode === 'read-only')
        return 0;
    if (mode === 'workspace-write')
        return 1;
    return 2;
}
function isSandboxMode(value) {
    return value === 'read-only' || value === 'workspace-write' || value === 'danger-full-access';
}
function isOutcome(value) {
    return value === 'allowed-once' || value === 'rejected' || value === 'cancelled' || value === 'unavailable';
}
function hasOpenTurn(events) {
    for (let index = events.length - 1; index >= 0; index -= 1) {
        const type = events[index]?.type;
        if (type === 'turn/start')
            return true;
        if (type === 'turn/end')
            return false;
    }
    return false;
}
/** 从尾部读取某类事件的最后值。 */
function lastEventValue(events, type, read) {
    for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index];
        if (event?.type === type)
            return read(event);
    }
    return undefined;
}
//# sourceMappingURL=permissions.js.map