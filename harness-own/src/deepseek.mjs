import { sse } from './sse.mjs'

/** 把会话历史转成OpenAI兼容消息；工具回复用tool角色关联tool_call_id。 */
export function toMessages(history) {
  return history.map(message => {
    if (message.role === 'tool') return { role: 'tool', tool_call_id: message.callId, content: JSON.stringify(message.content) }
    if (message.role === 'assistant') {
      // 只回放同一协议保存的消息，避免把旧Messages内容块发给Chat Completions。
      if (message.replay?.provider === 'deepseek' && message.replay.api === 'openai-chat') return structuredClone(message.replay.message)
      const value = { role: 'assistant', content: message.content ?? '' }
      if (message.thinking?.length) value.reasoning_content = message.thinking.map(block => block.text).join('')
      if (message.calls?.length) value.tool_calls = message.calls.map(call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } }))
      return value
    }
    return { role: message.role === 'system' ? 'system' : 'user', content: structuredClone(message.content) }
  })
}

/** DeepSeek的OpenAI兼容流；保留推理、工具调用与下一请求所需的assistant消息。 */
export class DeepSeekModel {
  /** baseURL是接口根地址；可含/v1，不重复添加版本路径。 */
  constructor({ baseURL = 'https://api.deepseek.com', key, model = 'deepseek-flash', fetcher = fetch }) {
    this.root = baseURL.replace(/\/+$/, '')
    this.key = key; this.model = model; this.fetcher = fetcher
  }
  /** 每次请求使用本轮快照；完整收到finish_reason和[DONE]后才交付工具调用。 */
  async *stream(request) {
    request.signal.throwIfAborted()
    // 请求历史、工具定义与用量选项，都使用Chat Completions字段。
    const history = toMessages(request.messages)
    if (request.config?.system) history.unshift({ role: 'system', content: request.config.system })
    const body = { model: request.config?.model ?? this.model, max_tokens: request.config?.maxTokens ?? 8192, stream: true,
      stream_options: { include_usage: true }, messages: history }
    if (request.tools.length) body.tools = request.tools.map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.schema } }))
    if (request.config?.thinking !== undefined) body.thinking = structuredClone(request.config.thinking)
    if (request.config?.reasoningEffort !== undefined) body.reasoning_effort = request.config.reasoningEffort
    const response = await this.fetcher(this.root + '/chat/completions', {
      method: 'POST', signal: request.signal,
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + this.key }, body: JSON.stringify(body),
    })
    if (!response.ok) throw Error('模型 HTTP ' + response.status)
    if (!response.body) throw Error('模型响应没有正文')
    // 一次只请求一个候选；同一工具的参数可能分散在多条SSE事件里。
    const calls = new Map()
    let content = '', reasoning = '', sawReasoning = false, finish, ended = false
    for await (const raw of sse(response.body)) {
      request.signal.throwIfAborted()
      if (raw === '[DONE]') { ended = true; break }
      const event = JSON.parse(raw)
			// console.log('DeepSeek SSE raw:', raw) // --- DEBUG ---
			console.log('DeepSeek SSE event:', JSON.stringify(event, null, 2)) // --- DEBUG ---
      if (event.error) throw Error(event.error.message ?? '模型流错误')
      if (event.usage) yield { kind: 'usage', ...event.usage }
      if (!Array.isArray(event.choices)) throw Error('模型流缺少choices')
      for (const choice of event.choices) {
        if (choice.index !== 0) throw Error('本步只支持单个模型候选')
        if (finish !== undefined) throw Error('模型在finish_reason之后继续返回候选')
        const delta = choice.delta ?? {}
        if (typeof delta.content === 'string') { content += delta.content; if (delta.content) yield { kind: 'text', text: delta.content } }
        if (typeof delta.reasoning_content === 'string') { reasoning += delta.reasoning_content; sawReasoning = true }
        for (const part of delta.tool_calls ?? []) {
          if (!Number.isSafeInteger(part.index) || part.index < 0) throw Error('工具分片缺少合法index')
          const call = calls.get(part.index) ?? { id: '', name: '', json: '' }
          if (part.id) { if (call.id && call.id !== part.id) throw Error('工具调用身份变化'); call.id = part.id }
          if (part.type && part.type !== 'function') throw Error('不支持的工具类型')
          if (part.function?.name) call.name += part.function.name
          if (part.function?.arguments !== undefined) {
            if (typeof part.function.arguments !== 'string') throw Error('工具参数分片应为字符串')
            call.json += part.function.arguments
          }
          calls.set(part.index, call)
        }
        if (choice.finish_reason != null) finish = choice.finish_reason
      }
    }
    if (!ended || !finish) throw Error('模型消息未完整结束：缺少finish_reason或[DONE]')
    if (!['stop', 'length', 'tool_calls'].includes(finish)) throw Error('模型异常结束：' + finish)
    if ((finish === 'tool_calls') !== (calls.size > 0)) throw Error('工具调用与finish_reason不匹配')
    // 完整验证所有工具后再交付，不能把缺字段或截断JSON当作可执行调用。
    const parsed = [], identities = new Set()
    for (const [, call] of [...calls.entries()].sort(([left], [right]) => left - right)) {
      if (!call.id || !call.name || identities.has(call.id)) throw Error('工具调用身份或名称不完整/重复')
      identities.add(call.id)
      const args = JSON.parse(call.json)
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw Error('工具参数应为对象')
      parsed.push({ id: call.id, name: call.name, arguments: args, json: call.json })
    }
    request.signal.throwIfAborted()
    if (sawReasoning) yield { kind: 'thinking', text: reasoning }
    for (const call of parsed) yield { kind: 'tool', id: call.id, name: call.name, arguments: call.arguments }
    // DeepSeek工具续轮需要保留reasoning_content，不能只保存最终文字。
    const message = { role: 'assistant', content }
    if (sawReasoning) message.reasoning_content = reasoning
    if (parsed.length) message.tool_calls = parsed.map(call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.json } }))
    yield { kind: 'replay', value: { provider: 'deepseek', api: 'openai-chat', message } }
    yield { kind: 'finish', reason: finish === 'tool_calls' ? 'tools' : finish }
  }
}