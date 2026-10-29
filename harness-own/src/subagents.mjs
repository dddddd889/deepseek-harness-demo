import { id } from './events.mjs'

/** 子Agent是可继续对话的资源，不是一次性的Promise快捷方式。 */
export class Subagents {
  entries = new Map()
  constructor(factory) { this.factory = factory }
  async create(scope, parent, options = {}) {
    const childId = id('child'), agent = await this.factory(options)
    this.entries.set(childId, { parent, agent })
    scope.own(async () => { await agent.close(); this.entries.delete(childId) })
    return childId
  }
  /** 所有观察控制均检查父身份。 */
  get(parent, childId) { const child = this.entries.get(childId); if (!child || child.parent !== parent) throw Error('没有子Agent权限'); return child.agent }
  send(parent, childId, text) { return this.get(parent, childId).submit(text) }
  async wait(parent, childId) { const agent = this.get(parent, childId); await agent.idle(); return agent.session.read() }
  interrupt(parent, childId) { this.get(parent, childId).cancel() }
}