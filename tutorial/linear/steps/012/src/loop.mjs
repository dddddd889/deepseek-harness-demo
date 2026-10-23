import { id } from './events.mjs'
import { messages } from './projection.mjs'

/** 一个 turn 由多个模型 step 组成；工具调用和结果成组写入事实。 */
export async function runTurn({ session, model, tools, signal, config = {}, inbox, maxSteps = 20 }, content) {
  const turnId = id('turn')
  session.append('turn/start', { turnId })
  session.append('message/user', { role: 'user', content })
  let ending = 'limit', partial = ''
  try {
    for (let step = 0; step < maxSteps; step++) {
      signal.throwIfAborted()
      // 只在 step 边界注入 steer，不改正在传输的请求。
      let input
      while ((input = inbox?.claim('step'))) session.append('message/user', { role: 'user', content: input.content, source: 'steer' })
      const requestId = id('request'), history = messages(session.read()), catalog = tools.catalog()
      session.append('request/start', { turnId, requestId, step, config, messages: history, tools: catalog })
      const calls = [], thinking = []
      let finish
      partial = ''
      for await (const part of model.stream({ messages: history, tools: catalog, config, signal, requestId })) {
        signal.throwIfAborted()
        if (part.kind === 'text') { partial += part.text; session.append('stream/text', { turnId, requestId, text: part.text }) }
        if (part.kind === 'thinking') thinking.push(part)
        if (part.kind === 'tool') {
          if (calls.some(call => call.id === part.id)) throw Error('重复工具调用身份')
          calls.push(part)
        }
        if (part.kind === 'usage') session.append('request/usage', { requestId, ...part })
        if (part.kind === 'replay') session.append('request/replay', { requestId, value: part.value })
        if (part.kind === 'finish') finish = part.reason
      }
      if (!finish) throw Error('模型流提前结束')
      if (calls.length && finish !== 'tools') throw Error('工具组与停止原因不匹配')
      session.append('message/assistant', { role: 'assistant', content: partial, calls, thinking })
      partial = ''
      session.append('request/end', { requestId, reason: finish })
      if (finish !== 'tools') { ending = finish === 'stop' ? 'completed' : 'length'; break }
      if (!calls.length) throw Error('工具结束但没有工具调用')
      for (const call of calls) {
        session.append('tool/start', { turnId, call }) // 行动前的持久边界。
        let result
        try { result = { ok: true, value: await tools.execute(call, { signal, session, turnId }) } }
        catch (error) { result = { ok: false, error: signal.aborted ? 'CANCELLED_OR_OUTCOME_UNKNOWN' : error.message } }
        session.append('message/tool', { role: 'tool', callId: call.id, name: call.name, content: result })
      }
    }
  } catch (error) {
    // 保留取消前真正收到的文字，但不伪装成成功完成。
    if (partial) session.append('message/assistant', { role: 'assistant', content: partial, interrupted: true })
    ending = signal.aborted ? 'cancelled' : 'error'
    if (ending === 'error') session.append('turn/error', { turnId, message: error.message })
  }
  session.append('turn/end', { turnId, reason: ending })
  return { turnId, reason: ending }
}
