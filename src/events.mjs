import { randomUUID } from 'node:crypto'

/** 每类身份带可见前缀，调试时能立刻看出串错了什么。 */
export function id(kind) { return kind + '_' + randomUUID() }

/** Session 只保存事实；界面和模型通过投影读取，不直接改历史。 */
export class Events {
  records = []
  listeners = new Set()
  constructor(sessionId = id('session'), persist = () => {}) { this.id = sessionId; this.persist = persist }
  /** 先持久化，再发布；持久化失败时内存与订阅者都不能看到成功。 */
  append(type, data) {
    const record = { format: 1, sessionId: this.id, seq: this.records.length, time: Date.now(), type, data: structuredClone(data) }
    this.persist(record)
    this.records.push(record)
    for (const listener of [...this.listeners]) {
      // 展示订阅者失败不能回滚已经提交的事实。
      try { listener(structuredClone(record)) } catch {}
    }
    return structuredClone(record)
  }
  /** 读取副本，防止 UI 改写已经提交的消息。 */
  read(after = -1) { return structuredClone(this.records.filter(record => record.seq > after)) }
  /** 每个订阅者独立撤销。 */
  on(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener) }
}