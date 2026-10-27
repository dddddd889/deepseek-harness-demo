/** 教学用事件记录器；保存样例状态，不实现Todo等领域的完整业务服务。 */
export class Collaboration {
  constructor(session) { this.session = session }
  /** 由完整事实重建，不把内存Map当永久状态。 */
  state(kind) {
    return this.session.read().filter(event => event.type === 'collaboration/' + kind).reduce((state, event) => ({ ...state, [event.data.id]: event.data }), {})
  }
  set(kind, value) {
    const states = { todo: ['pending', 'doing', 'done'], plan: ['draft', 'review', 'accepted', 'rejected'], goal: ['active', 'paused', 'completed'], schedule: ['pending', 'delivered'] }
    if (!states[kind]?.includes(value.status) || !value.id) throw Error('协作状态不合法')
    this.session.append('collaboration/' + kind, value)
  }
  /** 手动扫描提醒样例；回调后再记结果，副作用投递方仍需按id保持幂等。 */
  async due(now, deliver) {
    for (const value of Object.values(this.state('schedule'))) {
      if (value.status !== 'pending' || value.at > now) continue
      await deliver(value.id, value.text)
      this.set('schedule', { ...value, status: 'delivered' })
    }
  }
  /** UI反馈sidecar是自己的事件，不自动拼进模型对话。 */
  feedback(messageSeq, rating, text) { this.session.append('feedback', { messageSeq, rating, text }) }
}