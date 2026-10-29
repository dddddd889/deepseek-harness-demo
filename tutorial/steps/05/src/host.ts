import type { Approval, Model, Message } from './domain';
import { runAgent } from './agent';
import { Session } from './session';
import { Tools, registerRead } from './tools';
// Host 维护会话和当前运行；跨入口统一发生在这一层。
export class Host {
  sessions = new Map<string, Session>();
  private active = new Map<string, { controller: AbortController; done: Promise<string> }>();
  tools = new Tools();
  constructor(public model: Model, public workspace: string, public directory?: string,
    public prepare?: (messages: Message[]) => Message[]) { registerRead(this.tools, workspace); }
  create(id: string = crypto.randomUUID()) {
    if (this.sessions.has(id)) throw new Error('会话已存在');
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new Error('会话标识非法');
    const session = new Session(id, this.directory);
    this.sessions.set(id, session);
    return session;
  }
  get(id: string) {
    const session = this.sessions.get(id);
    if (!session) throw new Error('会话不存在');
    return session;
  }
  start(id: string, prompt: string, approve?: Approval) {
    this.get(id);
    if (!prompt.trim()) throw new Error('任务不能为空');
    if (this.active.has(id)) throw new Error('会话忙，请等待或取消当前任务');
    const controller = new AbortController();
    const turnId = crypto.randomUUID();
    // 延到微任务启动，确保 active 已登记，订阅者可立即取消。
    const done = Promise.resolve().then(() => runAgent({ session: this.get(id), model: this.model,
      tools: this.tools, prompt, signal: controller.signal, turnId, approve, prepare: this.prepare }))
      .finally(() => { this.active.delete(id); });
    this.active.set(id, { controller, done });
    return { turnId, done };
  }
  cancel(id: string) { this.get(id); this.active.get(id)?.controller.abort(); }
  busy(id: string) { return this.active.has(id); }
  async close() {
    for (const job of this.active.values()) job.controller.abort();
    await Promise.allSettled([...this.active.values()].map(job => job.done));
  }
}
