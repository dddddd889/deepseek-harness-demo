import { normalizeContext } from '@earendil-works/pi-ai'
import { streamSimple } from '@earendil-works/pi-ai/api/openai-completions'

/** pi-ai 专管模型访问，Harness 继续拥有 Loop、工具、权限和持久事实。 */
export class PiModel {
  constructor(model, apiKey, fetcher = fetch, stream = streamSimple) { this.model = model; this.key = apiKey; this.fetcher = fetcher; this.start = stream }
  /** 完整 assistant replay 优先，避免把 provider 特有签名转换丢失。 */
  context(request) {
    const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }
    return normalizeContext({ systemPrompt: request.config?.system ?? '',
      messages: request.messages.map(message => {
        if (message.replay?.provider === 'pi') return structuredClone(message.replay.message)
        if (message.role === 'user') return { role: 'user', content: message.content, timestamp: 0 }
        if (message.role === 'tool') return { role: 'toolResult', toolCallId: message.callId, toolName: message.name, isError: !message.content.ok, content: [{ type: 'text', text: JSON.stringify(message.content) }], timestamp: 0 }
        return { role: 'assistant', content: [...(message.content ? [{ type: 'text', text: message.content }] : []), ...(message.calls ?? []).map(call => ({ type: 'toolCall', id: call.id, name: call.name, arguments: call.arguments }))], api: this.model.api, provider: this.model.provider, model: this.model.id, stopReason: message.calls?.length ? 'toolUse' : 'stop', usage: zero, timestamp: 0 }
      }), tools: request.tools.map(tool => ({ name: tool.name, description: tool.description, parameters: tool.schema })) })
  }
  /** 接口事件转回自己定义的 Part，Loop 不依赖任何 pi-ai 字段。 */
  async *stream(request) {
    let ended = false
    for await (const event of this.start(this.model, this.context(request), { apiKey: this.key, signal: request.signal, fetch: this.fetcher, maxTokens: request.config?.maxTokens ?? 2048 })) {
      request.signal.throwIfAborted()
      if (event.type === 'text_delta') yield { kind: 'text', text: event.delta }
      if (event.type === 'error') throw Error(event.error.errorMessage ?? 'pi-ai 请求失败')
      if (event.type === 'done') {
        ended = true
        for (const block of event.message.content) {
          if (block.type === 'toolCall') yield { kind: 'tool', id: block.id, name: block.name, arguments: block.arguments }
          if (block.type === 'thinking') yield { kind: 'thinking', text: block.thinking, signature: block.thinkingSignature }
        }
        yield { kind: 'usage', ...event.message.usage }
        yield { kind: 'replay', value: { provider: 'pi', message: event.message } }
        yield { kind: 'finish', reason: event.reason === 'toolUse' ? 'tools' : event.reason === 'stop' ? 'stop' : 'length' }
      }
    }
    if (!ended) throw Error('pi-ai 流提前结束')
  }
}