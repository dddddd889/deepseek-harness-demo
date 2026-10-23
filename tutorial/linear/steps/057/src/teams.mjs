/** 实验团队保留成员名与任务状态；失败成员名也不复用。 */
export class Team {
  constructor(store, lead, create, send, interrupt) { this.store = store; this.lead = lead; this.createAgent = create; this.sendAgent = send; this.interruptAgent = interrupt }
  state() { return { members: {}, tasks: {}, ...this.store.read() } }
  async create(actor, name) {
    if (actor !== this.lead || !/^[a-z][a-z0-9-]*$/.test(name)) throw Error('仅Lead可创建合法成员')
    if (this.state().members[name]) throw Error('成员名不可复用')
    this.store.update(value => { value.members ??= {}; value.members[name] = { status: 'provisioning' }; return value })
    try {
      const id = await this.createAgent(name)
      this.store.update(value => { value.members[name] = { id, status: 'inactive' }; return value }); return id
    } catch (error) { this.store.update(value => { value.members[name].status = 'failed'; return value }); throw error }
  }
  /** 直接使用目标Inbox；Team不悄悄重发失败消息。 */
  send(actor, name, text) { if (actor !== this.lead && !this.state().members[actor]) throw Error('未知团队发送者'); const member = this.state().members[name]; if (!member?.id) throw Error('成员不可用'); return this.sendAgent(member.id, text) }
  interrupt(actor, name) { if (actor !== this.lead) throw Error('仅Lead可中断'); return this.interruptAgent(this.state().members[name].id) }
  task(id, after = []) {
    const state = this.state()
    if (state.tasks[id] || after.includes(id) || after.some(parent => !state.tasks[parent])) throw Error('任务依赖不合法')
    this.store.update(value => { value.tasks ??= {}; value.tasks[id] = { id, after, status: 'pending' }; return value })
  }
  claim(id, actor) {
    const state = this.state(), task = state.tasks[id]
    if (!task || task.status !== 'pending' || !task.after.every(parent => state.tasks[parent].status === 'done')) throw Error('任务尚不可认领')
    this.store.update(value => { value.tasks[id] = { ...task, owner: actor, status: 'doing' }; return value })
  }
  complete(id, actor) { this.store.update(value => { if (value.tasks[id]?.owner !== actor) throw Error('不是任务owner'); value.tasks[id].status = 'done'; return value }) }
}
