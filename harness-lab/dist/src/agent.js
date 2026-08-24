import { createMessage } from "./domain.js";
import { LlmRuntime } from "./llm.js";
import { runModelStep } from "./model-step.js";
import { deriveMessages } from "./projections.js";
import { Session } from "./session.js";
import { executeToolCalls } from "./tool-execution.js";
import { ToolRegistry } from "./tools.js";
import { PermissionService } from "./permissions.js";
/** 最小 收件箱驱动的智能体；一次运行会原子认领当时排队的全部用户消息。 */
export class HarnessAgent {
    session;
    runtime;
    config;
    tools;
    permissions;
    #inbox = [];
    #statusListeners = new Set();
    #status = 'idle';
    #abort;
    constructor(session, runtime, config, tools = new ToolRegistry(), permissions) {
        this.session = session;
        this.runtime = runtime;
        this.config = config;
        this.tools = tools;
        this.permissions = permissions;
    }
    get status() { return this.#status; }
    get pendingMessages() { return this.#inbox.length; }
    /** 用户输入只进入 收件箱；真正写入会话 必须等某个 轮次成功认领。 */
    send(text) {
        return this.sendContent([{ type: 'text', text }]);
    }
    /** 接受已通过宿主边界验证的富内容；收件箱 仍只保存不可变消息。 */
    sendContent(content) {
        if (content.length === 0)
            throw new TypeError('用户消息 content 不能为空');
        const message = createMessage({ role: 'user', content, source: { kind: 'user' } });
        this.#inbox.push(message);
        return message;
    }
    onStatus(listener) {
        this.#statusListeners.add(listener);
        return () => this.#statusListeners.delete(listener);
    }
    /** 取消当前模型读取；归一化后的 已取消终止帧 仍会进入会话。 */
    cancel(reason = new Error('用户取消')) {
        this.#abort?.abort(reason);
    }
    async run(externalSignal) {
        if (this.#status === 'running')
            throw new Error('智能体正在运行，禁止并发执行');
        if (this.#inbox.length === 0)
            return undefined;
        const claimed = this.#inbox.splice(0);
        const turn = this.nextTurn();
        this.#abort = new AbortController();
        const signal = externalSignal
            ? AbortSignal.any([this.#abort.signal, externalSignal])
            : this.#abort.signal;
        this.setStatus('running');
        this.session.append('turn/start', { turn });
        for (const message of claimed)
            this.session.append('user/message', message);
        try {
            const maxSteps = this.config.maxSteps ?? 100;
            for (let step = 1; step <= maxSteps; step += 1) {
                this.session.append('step/start', { turn, step });
                const schemas = this.tools.schemas();
                const model = await runModelStep(this.runtime, this.session, turn, step, {
                    provider: this.config.provider,
                    model: this.config.model,
                    messages: deriveMessages(this.session.events),
                    ...(this.config.system === undefined ? {} : { system: this.config.system }),
                    ...(schemas.length === 0 ? {} : { tools: schemas }),
                }, signal);
                if (model.finish.kind === 'error' || model.finish.kind === 'aborted') {
                    this.session.append('step/end', { turn, step });
                    const reason = model.finish.kind === 'error'
                        ? { kind: 'error', error: model.finish.failure }
                        : { kind: 'aborted', reason: 'user' };
                    this.session.append('turn/end', { turn, reason });
                    return { turn, reason };
                }
                if (model.finish.kind === 'max-tokens') {
                    this.session.append('step/end', { turn, step });
                    const reason = { kind: 'max-tokens' };
                    this.session.append('turn/end', { turn, reason });
                    return { turn, reason, ...(model.message === undefined ? {} : { message: model.message }) };
                }
                const calls = model.message?.content.filter(block => block.type === 'tool-call') ?? [];
                if (calls.length > 0) {
                    await executeToolCalls(this.tools, this.session, turn, step, calls, signal, this.permissions);
                    this.session.append('step/end', { turn, step });
                    if (signal.aborted) {
                        const reason = { kind: 'aborted', reason: 'user' };
                        this.session.append('turn/end', { turn, reason });
                        return { turn, reason };
                    }
                    continue;
                }
                this.session.append('step/end', { turn, step });
                const reason = model.finish.kind === 'tool-calls' ? { kind: 'blocked' } : { kind: 'completed' };
                this.session.append('turn/end', { turn, reason });
                return { turn, reason, ...(model.message === undefined ? {} : { message: model.message }) };
            }
            const reason = {
                kind: 'error', error: { code: 'MAX_STEPS', message: `Agent 超过最大步数 ${this.config.maxSteps ?? 100}` },
            };
            this.session.append('turn/end', { turn, reason });
            return { turn, reason };
        }
        finally {
            this.#abort = undefined;
            this.setStatus('idle');
        }
    }
    /** 从已存在日志计算下一个轮次，使恢复后的智能体 不会重用编号。 */
    nextTurn() {
        let maximum = 0;
        for (const event of this.session.events) {
            if ('turn' in event.data)
                maximum = Math.max(maximum, event.data.turn);
        }
        return maximum + 1;
    }
    setStatus(status) {
        this.#status = status;
        for (const listener of this.#statusListeners)
            listener(status);
    }
}
//# sourceMappingURL=agent.js.map