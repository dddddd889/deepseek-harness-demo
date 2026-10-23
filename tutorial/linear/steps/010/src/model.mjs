import { setTimeout as delay } from 'node:timers/promises'

/** 固定外部模型响应；仍通过与真模型相同的异步事件接口。 */
export class ScriptModel {
  requests = []
  constructor(script) { this.script = [...script] }
  /** request 包含完整历史、工具、配置与 signal，输出是语义增量。 */
  async *stream(request) {
    this.requests.push(request)
    const response = this.script.shift()
    if (response === undefined) throw Error('固定模型脚本耗尽')
    if (response === 'hang') {
      yield { kind: 'text', text: 'partial' }
      await delay(60_000, undefined, { signal: request.signal })
      return
    }
    for (const part of response) { request.signal.throwIfAborted(); yield structuredClone(part) }
  }
}

/** 创建文字样本；finish 只结束一次模型请求，不是整轮任务。 */
export function answer(text) { return [{ kind: 'text', text }, { kind: 'finish', reason: 'stop' }] }

/** 工具样本保留完整调用身份，执行结果必须关联同一个 id。 */
export function call(name, args = {}, id = 'call-1') {
  return [{ kind: 'tool', id, name, arguments: args }, { kind: 'finish', reason: 'tools' }]
}
