import { test, expect } from 'bun:test';
import { Tools } from '../src/tools';
import { fakeModel } from '../src/fake-model';
import { registerSubagent } from '../src/subagent';
// 子任务可读取文件，但工具表里没有写入和再次委派的能力。
test('子 Agent 有独立工具边界', async () => {
  const tools = new Tools(); registerSubagent(tools, process.cwd(), fakeModel);
  const run = (task: string) => tools.execute({ id: 'c', type: 'function', function: { name: 'delegate_read', arguments: JSON.stringify({ task }) } }, new AbortController().signal);
  expect(await run('/tool read {"path":"package.json"}')).toContain('my-harness');
  expect(await run('/tool write {"path":"oops.txt","content":"x"}')).toContain('未知工具');
});
