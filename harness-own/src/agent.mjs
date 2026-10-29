import { Inbox } from './inbox.mjs'
import { runTurn } from './loop_012.mjs'

/** Agent 是活动的所有者；收到输入不等于开始执行。 */
export class Agent {
  active = undefined
  controller = undefined
  closed = false
  failure = undefined
  constructor(session, model, tools, settings) {
    this.session = session; this.model = model; this.tools = tools; this.settings = settings
    this.inbox = new Inbox(session)
  }
  /** 返回接收凭据，正在运行时也可以排队或 steer。 */
  submit(content, destination = 'turn') {
    if (this.closed) throw Error('Agent 已关闭')
    const receipt = this.inbox.enqueue(content, destination)
    this.pump()
    return receipt
  }
  /** 同一会话单个 pump，配置只在新 turn 请求时固定。 */
  pump() {
    if (this.active || this.closed) return
    this.active = Promise.resolve().then(async () => {
      let input
      while (!this.closed && (input = this.inbox.claim('turn'))) {
        this.controller = new AbortController()
        const config = this.settings.snapshot()
        await runTurn({ session: this.session, tools: this.tools, model: this.model, config, inbox: this.inbox, signal: this.controller.signal }, input.content)
      }
    }).finally(() => { this.controller = undefined; this.active = undefined })
    // 即使接入方只取接收凭据，也不能产生未处理的Promise拒绝。
    this.active.catch(error => { this.failure = error; this.closed = true })
  }
  /** 取消当前活动，不取消未来排队的独立任务。 */
  cancel() { this.controller?.abort(new Error('用户取消')) }
  /** 等待事实与活动都收敛后再报告空闲。 */
  async idle() { while (this.active) await this.active; if (this.failure) throw this.failure }
  /** 禁止新输入，取消当前活动并等待清理。 */
  async close() { this.closed = true; this.cancel(); await this.idle() }
}