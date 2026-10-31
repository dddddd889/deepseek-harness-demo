/** Client读模型按seq去重，连接generation只用来拒绝旧连接。 */
export class View {
  generation = 0
  seq = -1
  events = []
  waiting = new Map()
  /** 重连重新订阅快照，保留已经接纳的位置，不重复拼接文字。 */
  reconnect() { return ++this.generation }
  apply(event, generation = this.generation) {
    if (generation !== this.generation || event.seq <= this.seq) return
    if (event.seq - this.seq > 10_000) throw Error('视图事件缺口过大，需要重载')
    this.waiting.set(event.seq, event)
    while (this.waiting.has(this.seq + 1)) {
      this.seq++; this.events.push(this.waiting.get(this.seq)); this.waiting.delete(this.seq)
    }
  }
  /** 待审批与已提交消息从同一事实派生，刷新不会复活旧按钮。 */
  state() {
    const approvals = new Map(), stream = new Map(), messages = [], tools = new Map()
    for (const event of this.events) {
      const value = event.data
      if (event.type === 'approval/request') approvals.set(value.id, value)
      if (event.type === 'approval/settled') approvals.delete(value.id)
      if (event.type === 'stream/text') stream.set(value.requestId, (stream.get(value.requestId) ?? '') + value.text)
      if (event.type === 'message/assistant' || event.type === 'message/user') { messages.push(value); if (event.type === 'message/assistant') stream.clear() }
      if (event.type === 'tool/start') tools.set(value.call.id, { name: value.call.name, status: 'running', input: value.call.arguments })
      if (event.type === 'message/tool') tools.set(value.callId, { ...tools.get(value.callId), status: value.content.ok ? 'completed' : 'failed', result: value.content })
    }
    return { approvals: [...approvals.values()], messages, text: [...stream.values()].join(''), tools: [...tools.values()] }
  }
}
