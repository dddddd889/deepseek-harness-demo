import { test, expect } from 'bun:test';
import { runAgent } from '../src/agent';
import { Session } from '../src/session';
import { Tools, registerRead } from '../src/tools';
import { fakeModel } from '../src/fake-model';
// 证明工具结果进入第二次模型请求，而不只是展示在控制台。
test('读文件后再次请求模型，只有一个 turn 终止事件', async () => {
  const session = new Session();
  const tools = new Tools();
  registerRead(tools, process.cwd());
  const result = await runAgent({ session, tools, model: fakeModel,
    prompt: '/tool read {"path":"package.json"}', signal: new AbortController().signal });
  expect(result).toBe('stop');
  expect(session.events.filter(event => event.type === 'step')).toHaveLength(2);
  expect(session.events.filter(event => event.type === 'done')).toHaveLength(1);
  expect(session.messages.at(-1)?.content).toContain('my-harness');
});
