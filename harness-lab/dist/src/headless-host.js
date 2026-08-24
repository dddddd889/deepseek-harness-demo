import { randomUUID } from 'node:crypto';
import { HarnessAgent } from "./agent.js";
import { DeepSeekProvider } from "./deepseek-provider.js";
import { LlmRuntime, ScriptedLlmProvider } from "./llm.js";
import { HarnessBundle } from "./bundle.js";
import { PermissionService } from "./permissions.js";
import { JsonlSessionStore as Store } from "./session-store.js";
export class HeadlessConversation {
    #host;
    header;
    session;
    agent;
    #closed = false;
    constructor(host, header, session, agent) {
        this.#host = host;
        this.header = header;
        this.session = session;
        this.agent = agent;
    }
    async run(task, signal) {
        if (this.#closed)
            throw new Error('对话已关闭');
        if (task.trim() === '')
            throw new TypeError('任务不能为空');
        return this.runContent([{ type: 'text', text: task }], signal);
    }
    async runContent(content, signal) {
        if (this.#closed)
            throw new Error('对话已关闭');
        this.agent.sendContent(content);
        const result = await this.agent.run(signal);
        if (result === undefined)
            throw new Error('智能体未接受任务');
        await this.#host.flush(this.session);
        const text = result.message?.content.filter(block => block.type === 'text').map(block => block.text).join('') ?? '';
        return { sessionId: this.header.id, turn: result.turn, text, reason: result.reason };
    }
    async close() {
        if (this.#closed)
            return;
        this.#closed = true;
        await this.#host.closeConversation(this.session);
    }
}
/** 无 HTTP 的宿主：配置、提供方、会话存储与智能体的统一装配入口。 */
export class HeadlessHost {
    profile;
    bundle;
    #runtime = new LlmRuntime();
    #store;
    #interactions;
    #conversations = new Set();
    constructor(profile, store, provider, bundle, interactions) {
        this.profile = profile;
        this.#store = store;
        this.bundle = bundle;
        this.#interactions = interactions;
        this.#runtime.register(profile.provider, provider);
    }
    static async open(profile, providerOverride, interactions) {
        const provider = providerOverride ?? (profile.provider === 'deepseek'
            ? new DeepSeekProvider({
                apiKey: () => process.env[profile.apiKeyEnv],
                ...(profile.baseURL === undefined ? {} : { baseURL: profile.baseURL }),
            })
            : scriptedProvider(profile.scriptedResponse ?? ''));
        const store = await Store.open(profile.persistenceRoot);
        const bundle = new HarnessBundle();
        const runtime = { provider };
        await bundle.mount([
            { name: 'profile', apply: context => context.provide('profile', profile) },
            { name: 'session-store', apply: context => context.provide('sessions', store) },
            { name: 'llm-provider', apply: context => context.provide('llm-provider', runtime) },
        ]);
        return new HeadlessHost(profile, store, provider, bundle, interactions);
    }
    async create(sessionId = `session-${randomUUID()}`) {
        const created = await this.#store.create(sessionId, this.profile.cwd);
        return this.#conversation(created.header, created.session);
    }
    async resume(sessionId) {
        const resumed = await this.#store.resume(sessionId);
        return this.#conversation(resumed.header, resumed.session);
    }
    flush(session) { return this.#store.flush(session); }
    async closeConversation(session) {
        if (!this.#conversations.delete(session))
            return;
        await this.#store.close(session);
    }
    async dispose() {
        await this.bundle.dispose();
        await this.#store.dispose();
        this.#conversations.clear();
    }
    #conversation(header, session) {
        const permissions = new PermissionService({
            defaultMode: this.profile.sandboxMode,
            defaultApprovalPolicy: this.profile.approvalPolicy,
            ...(this.#interactions === undefined ? {} : { answerer: this.#interactions.answerer(header.id) }),
        });
        const agent = new HarnessAgent(session, this.#runtime, {
            provider: this.profile.provider, model: this.profile.model,
            maxSteps: this.profile.maxSteps,
            ...(this.profile.system === undefined ? {} : { system: this.profile.system }),
        }, undefined, permissions);
        this.#conversations.add(session);
        return new HeadlessConversation(this, header, session, agent);
    }
}
function scriptedProvider(response) {
    return new ScriptedLlmProvider([
        { type: 'block-start', index: 0, blockType: 'text' },
        { type: 'text-delta', index: 0, text: response },
        { type: 'block-end', index: 0, block: { type: 'text', text: response } },
        { type: 'usage', usage: { inputTokens: 1, outputTokens: Math.max(1, Math.ceil(response.length / 4)) } },
        { type: 'finish', reason: { kind: 'stop' } },
    ]);
}
//# sourceMappingURL=headless-host.js.map