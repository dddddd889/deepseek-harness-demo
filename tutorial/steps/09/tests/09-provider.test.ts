import { test, expect } from 'bun:test';
import { deepseekModel } from '../src/deepseek';
// 每个字节单独到达，覆盖中文 UTF-8 与 JSON 参数拆包；不调用付费 API。
test('SSE 拆包、工具参数重组、流截断', async () => {
  const frames = [
    { choices: [{ delta: { content: '你好', tool_calls: [{ index: 0, id: 'c1', function: { name: 'read', arguments: '{"path":' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"README.md"}' } }] }, finish_reason: 'tool_calls' }] },
  ].map(frame => 'data: ' + JSON.stringify(frame) + '\r\n\r\n').join('');
  const makeFetch = (raw: string) => (async () => new Response(new ReadableStream({ start(controller) {
    for (const byte of new TextEncoder().encode(raw)) controller.enqueue(Uint8Array.of(byte));
    controller.close();
  } }))) as unknown as typeof fetch;
  const read = async (raw: string) => {
    const parts = [];
    for await (const part of deepseekModel({ key: 'test', model: 'test' }, makeFetch(raw))([], [], new AbortController().signal)) parts.push(part);
    return parts;
  };
  const parts = await read(frames + 'data: [DONE]\r\n\r\n');
  expect(parts.find(part => part.type === 'text')).toEqual({ type: 'text', text: '你好' });
  expect(parts.find(part => part.type === 'call')).toMatchObject({ call: { function: { arguments: '{"path":"README.md"}' } } });
  await expect(read(frames)).rejects.toThrow('提前结束');
});
