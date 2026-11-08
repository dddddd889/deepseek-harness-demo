import { randomUUID } from 'node:crypto'

/** 用户问答：答案有结构，不能复用Approvals的boolean结算。 */
export class Questions {
  pending = new Map()
  /** publish只通知界面；示例没有接持久化日志。 */
  constructor(publish = () => {}) { this.publish = publish }
  /** 登记问题后等待回答；单选、多选、文本走同一个生命周期。 */
  request(owner, question, signal, timeout = 120_000) {
    signal.throwIfAborted()
    if (!['single', 'multiple', 'text'].includes(question.kind)) throw Error('未知问题类型')
    if (typeof question.title !== 'string' || !question.title.trim()) throw Error('问题标题不能为空')
    const options = question.options ?? []
    if (question.kind !== 'text' && (!Array.isArray(options) || !options.length || options.some(option => typeof option.id !== 'string' || !option.id || typeof option.label !== 'string') || new Set(options.map(option => option.id)).size !== options.length)) throw Error('问题选项不合法')
    const id = 'question_' + randomUUID(), snapshot = structuredClone(question)
    return new Promise((resolve, reject) => {
      let timer
      // 先删除再发布结算事件，重复提交和迟到回答都无法再次唤醒调用方。
      const finish = (answer, error) => {
        if (!this.pending.delete(id)) return
        clearTimeout(timer); signal.removeEventListener('abort', abort)
        try { this.publish({ type: 'question/settled', id, owner, status: error ? 'cancelled' : answer.status }) } catch {}
        if (error) reject(error); else resolve(answer)
      }
      const abort = () => finish(undefined, Error('任务已取消'))
      this.pending.set(id, { owner, question: snapshot, finish })
      signal.addEventListener('abort', abort, { once: true })
      // 超时是独立状态，不伪装成用户回答或拒绝权限。
      timer = setTimeout(() => finish({ status: 'timed_out' }), timeout)
      try { this.publish({ type: 'question/request', id, owner, question: structuredClone(snapshot) }) }
      catch (error) { finish(undefined, error) }
    })
  }
  /** 服务端校验真实owner和选项ID；错误答案不消耗待答问题。 */
  answer(owner, id, answer) {
    const pending = this.pending.get(id)
    if (!pending || pending.owner !== owner) throw Error('问题不存在或不属于当前会话')
    if (answer?.status === 'cancelled') { pending.finish({ status: 'cancelled' }); return }
    if (answer?.status !== 'answered') throw Error('回答状态不合法')
    const { kind, options = [] } = pending.question, value = answer.value
    const allowed = new Set(options.map(option => option.id))
    if (kind === 'single' && (typeof value !== 'string' || !allowed.has(value))) throw Error('请选择一个有效选项')
    if (kind === 'multiple' && (!Array.isArray(value) || !value.length || new Set(value).size !== value.length || value.some(id => !allowed.has(id)))) throw Error('请选择有效且不重复的选项')
    if (kind === 'text' && (typeof value !== 'string' || !value.trim() || value.length > 2000)) throw Error('文本应为1到2000字符')
    pending.finish({ status: 'answered', value: structuredClone(value) })
  }
}
