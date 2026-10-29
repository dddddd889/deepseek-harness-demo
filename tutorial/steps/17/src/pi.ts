import { normalizeContext, type Context, type Model as PiModel, type Message as PiMessage, type TSchema } from '@earendil-works/pi-ai';
import { streamSimple } from '@earendil-works/pi-ai/api/openai-completions';
import type { Model } from './domain';
// 只替换模型适配器：pi-ai 不接管我们的 Loop、审批、事件日志或 Host。
export function piModel(config: { key: string; model: string }, request: typeof fetch = fetch): Model {
  const model: PiModel<'openai-completions'> = {
    id: config.model, name: config.model, api: 'openai-completions', provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com', input: ['text'], reasoning: false,
    contextWindow: 32_000, maxTokens: 2048,
    // 不知道价格就不估算费用；这里的 0 不代表官方免费。
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    compat: { thinkingFormat: 'deepseek', supportsStore: false, supportsDeveloperRole: false, maxTokensField: 'max_tokens' },
  };
  return async function* (history, tools, parentSignal) {
    const messages: PiMessage[] = [];
    const names = new Map<string, string>();
    const zeroUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
    for (const message of history) {
      if (message.role === 'system') continue;
      if (message.role === 'user') messages.push({ role: 'user', content: message.content ?? '', timestamp: Date.now() });
      if (message.role === 'assistant') {
        const content: any[] = message.content ? [{ type: 'text', text: message.content }] : [];
        for (const call of message.tool_calls ?? []) {
          names.set(call.id, call.function.name);
          content.push({ type: 'toolCall', id: call.id, name: call.function.name, arguments: JSON.parse(call.function.arguments) });
        }
        messages.push({ role: 'assistant', content, api: model.api, provider: model.provider,
          model: model.id, timestamp: Date.now(), usage: zeroUsage, stopReason: message.tool_calls?.length ? 'toolUse' : 'stop' });
      }
      if (message.role === 'tool') messages.push({ role: 'toolResult', toolCallId: message.tool_call_id!,
        toolName: names.get(message.tool_call_id!) ?? 'unknown', content: [{ type: 'text', text: message.content ?? '' }], isError: false, timestamp: Date.now() });
    }
    const context: Context = { systemPrompt: history.filter(message => message.role === 'system').map(message => message.content).join('\n'), messages,
      tools: tools.map(tool => ({ ...tool, parameters: tool.parameters as TSchema })) };
    const signal = AbortSignal.any([parentSignal, AbortSignal.timeout(45_000)]);
    let completed = false;
    for await (const event of streamSimple(model, normalizeContext(context), { apiKey: config.key, signal, fetch: request, maxTokens: 2048 })) {
      signal.throwIfAborted();
      if (event.type === 'text_delta') yield { type: 'text', text: event.delta };
      if (event.type === 'error') throw new Error(event.error.errorMessage ?? 'pi-ai 模型流失败');
      if (event.type === 'done') {
        completed = true;
        for (const block of event.message.content) if (block.type === 'toolCall') yield { type: 'call',
          call: { id: block.id, type: 'function', function: { name: block.name, arguments: JSON.stringify(block.arguments) } } };
        yield { type: 'usage', input: event.message.usage.input, output: event.message.usage.output };
        yield { type: 'finish', reason: event.reason === 'toolUse' ? 'tool_calls' : event.reason };
      }
    }
    if (!completed) throw new Error('pi-ai 流缺少终止事件');
  };
}
