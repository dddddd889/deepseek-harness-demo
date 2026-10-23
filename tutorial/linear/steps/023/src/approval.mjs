import { id } from './events.mjs'

/** 审批是一次性的等待对象；所有权、迟答、取消各有明确语义。 */
export class Approvals {
  pending = new Map()
  constructor(publish = () => {}) { this.publish = publish }
  /** 先挂好监听和 pending，再发布，允许 UI 同步答复。 */
  request(owner, question, signal, timeout = 30_000) {
    signal.throwIfAborted()
    return new Promise((resolve, reject) => {
      const requestId = id('approval')
      let timer
      const finish = (answer, error) => {
        if (!this.pending.delete(requestId)) return
        clearTimeout(timer); signal.removeEventListener('abort', abort)
        this.publish({ type: 'approval/settled', id: requestId, owner })
        if (error) reject(error); else resolve(answer)
      }
      const abort = () => finish(false, new Error('审批已取消'))
      this.pending.set(requestId, { owner, question, finish })
      signal.addEventListener('abort', abort, { once: true })
      timer = setTimeout(() => finish(false, Error('审批超时')), timeout)
      try { this.publish({ type: 'approval/request', id: requestId, owner, question }) }
      catch (error) { finish(false, error) }
    })
  }
  /** 一旦结算，旧页面和另一客户端不能再答第二次。 */
  answer(owner, requestId, allowed) {
    const pending = this.pending.get(requestId)
    if (!pending || pending.owner !== owner) throw Error('审批不存在或不属于当前会话')
    pending.finish(allowed === true)
  }
}
