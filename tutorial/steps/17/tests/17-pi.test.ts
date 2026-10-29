import { test, expect } from 'bun:test';
import { piModel } from '../src/pi';
// 真实运行 pi-ai SDK，只把外部 HTTP 替换为固定 SSE，不使用付费 Key。
test('pi-ai 适配器把真实 SDK 分片转成领域事件', async () => {
  const chunk = (delta: any, finish_reason: string | null = null) => 'data: ' + JSON.stringify({
    id: 'test', object: 'chat.completion.chunk', created: 1, model: 'test', choices: [{ index: 0, delta, finish_reason }],
  }) + '\n\n';
  const raw = chunk({ role: 'assistant', content: '你好' }) + chunk({}, 'stop') + 'data: [DONE]\n\n';
  const request = (async () => new Response(raw, { headers: { 'Content-Type': 'text/event-stream' } })) as unknown as typeof fetch;
  const parts = [];
  for await (const part of piModel({ key: 'test', model: 'test' }, request)([{ role: 'user', content: '你好' }], [], new AbortController().signal)) parts.push(part);
  expect(parts.some(part => part.type === 'text' && part.text === '你好')).toBe(true);
  expect(parts.at(-1)).toEqual({ type: 'finish', reason: 'stop' });
});
