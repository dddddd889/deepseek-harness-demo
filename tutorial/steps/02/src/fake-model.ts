import { setTimeout as sleep } from 'node:timers/promises';
import type { Model, ToolCall } from './domain';
// 固定模型决定每个样本的行为，让调试不受真实模型随机性影响。
export const fakeModel: Model = async function* (messages, _tools, signal) {
  const userIndex = messages.findLastIndex(message => message.role === 'user');
  const prompt = messages[userIndex]?.content ?? '';
  const results = messages.slice(userIndex + 1).filter(message => message.role === 'tool');
  if (results.length) {
    yield { type: 'text', text: '工具结果：' + results.map(message => message.content).join('\n') };
  } else if (prompt.startsWith('/tool ')) {
    // 示例：/tool read {"path":"README.md"}。
    const match = /^\/tool (\S+) ([\s\S]+)$/.exec(prompt);
    if (!match) throw new Error('工具样本格式错误');
    const call: ToolCall = { id: crypto.randomUUID(), type: 'function',
      function: { name: match[1], arguments: match[2] } };
    yield { type: 'call', call };
  } else {
    for (const text of ['收到：', prompt, '。']) {
      signal.throwIfAborted();
      await sleep(prompt === '/slow' ? 500 : 10, undefined, { signal });
      if (prompt === '/error' && text === prompt) throw new Error('固定流故障');
      yield { type: 'text', text };
    }
  }
  yield { type: 'usage', input: 10, output: 5 };
  yield { type: 'finish', reason: results.length || !prompt.startsWith('/tool ') ? 'stop' : 'tool_calls' };
};
