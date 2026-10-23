import { id } from './events.mjs'

/** Inbox 的事实也入 Session；恢复时重新投影，而不是读取遗留内存队列。 */
export class Inbox {
  constructor(session) { this.session = session }
  /** 明确下一 turn 与下一 step 两个目的地。 */
  enqueue(content, destination = 'turn') {
    if (!['turn', 'step'].includes(destination)) throw Error('目的地不合法')
    const messageId = id('input')
    this.session.append('inbox/add', { id: messageId, content, destination })
    return messageId
  }
  /** 未认领前才能编辑或移除；认领后不再改变正在处理的输入。 */
  update(messageId, content) {
    if (!this.pending().some(row => row.id === messageId)) throw Error('输入已认领或不存在')
    this.session.append('inbox/edit', { id: messageId, content })
  }
  remove(messageId) {
    if (!this.pending().some(row => row.id === messageId)) throw Error('输入已认领或不存在')
    this.session.append('inbox/remove', { id: messageId })
  }
  /** 按事实顺序折叠队列，认领和删除都不可二次消费。 */
  pending() {
    const rows = new Map()
    for (const { type, data } of this.session.read()) {
      if (type === 'inbox/add') rows.set(data.id, { ...data })
      if (type === 'inbox/edit' && rows.has(data.id)) rows.get(data.id).content = data.content
      if (type === 'inbox/remove' || type === 'inbox/claim') rows.delete(data.id)
    }
    return [...rows.values()]
  }
  /** 同步持久化认领后才返回输入，避免同进程重复消费。 */
  claim(destination) {
    const row = this.pending().find(row => row.destination === destination)
    if (!row) return undefined
    this.session.append('inbox/claim', { id: row.id })
    return row
  }
}
