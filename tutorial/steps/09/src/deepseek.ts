import { setTimeout as sleep } from 'node:timers/promises';
import type { Model, ToolCall } from './domain';
import { sseData } from './sse';
// 适配器负责 HTTP、SSE 和工具参数拼接；上层始终使用同一个 Model。
export function deepseekModel(config: { key: string; model: string; baseUrl?: string; timeout?: number },
  request: typeof fetch = fetch): Model {
  return async function* (messages, tools, parentSignal) {
    const signal = AbortSignal.any([parentSignal, AbortSignal.timeout(config.timeout ?? 45_000)]);
    const endpoint = (config.baseUrl ?? 'https://api.deepseek.com').replace(/\/$/, '') + '/chat/completions';
    let response: Response | undefined;
    // 只重试尚未返回正文的 HTTP 错误；已输出分片后不能偷偷重放整次请求。
    for (let attempt = 0; attempt < 3; attempt++) {
      response = await request(endpoint, { method: 'POST', signal,
        headers: { Authorization: 'Bearer ' + config.key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: config.model, messages, stream: true, max_tokens: 2048,
          thinking: { type: 'disabled' }, stream_options: { include_usage: true },
          ...(tools.length ? { tools: tools.map(tool => ({ type: 'function', function: tool })) } : {}) }) });
      if (response.ok) break;
      await response.body?.cancel();
      if (attempt === 2 || (response.status !== 429 && response.status < 500)) throw new Error('模型 HTTP ' + response.status);
      await sleep(200 * 2 ** attempt, undefined, { signal });
    }
    if (!response?.ok || !response.body) throw new Error('模型响应缺少正文');
    const calls = new Map<number, ToolCall>();
    let done = false;
    let finish: string | undefined;
    let reasoning = '';
    for await (const data of sseData(response.body, signal)) {
      if (data === '[DONE]') { done = true; break; }
      const frame = JSON.parse(data);
      if (frame.error) throw new Error('模型返回错误帧');
      if (frame.usage) yield { type: 'usage', input: frame.usage.prompt_tokens ?? 0, output: frame.usage.completion_tokens ?? 0 };
      const choice = frame.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta ?? {};
      if (delta.content) yield { type: 'text', text: delta.content };
      reasoning += delta.reasoning_content ?? '';
      for (const piece of delta.tool_calls ?? []) {
        if (!Number.isInteger(piece.index) || piece.index < 0) throw new Error('工具分片索引非法');
        const call = calls.get(piece.index) ?? { id: '', type: 'function', function: { name: '', arguments: '' } };
        call.id += piece.id ?? '';
        call.function.name += piece.function?.name ?? '';
        call.function.arguments += piece.function?.arguments ?? '';
        if (call.function.arguments.length > 64_000) throw new Error('工具参数过大');
        calls.set(piece.index, call);
      }
      if (choice.finish_reason) finish = choice.finish_reason;
    }
    signal.throwIfAborted();
    if (!done || !finish) throw new Error('模型流提前结束');
    for (const [, call] of [...calls].sort(([a], [b]) => a - b)) {
      if (!call.id || !call.function.name) throw new Error('工具调用不完整');
      JSON.parse(call.function.arguments);
      yield { type: 'call', call };
    }
    yield { type: 'finish', reason: finish, reasoning };
  };
}
