import { test, expect } from 'bun:test';
import { Host } from '../src/host';
import { fakeModel } from '../src/fake-model';
// 通过事件精确触发取消，避免依赖机器快慢的任意 sleep。
test('收到首片后取消，不能再提交完整 assistant', async () => {
  const host = new Host(fakeModel, process.cwd());
  const session = host.create();
  session.subscribe(event => { if (event.type === 'text') host.cancel(session.id); });
  const job = host.start(session.id, '/slow');
  expect(() => host.start(session.id, '另一个任务')).toThrow('忙');
  expect(await job.done).toBe('cancelled');
  expect(session.events.filter(event => event.type === 'done')).toHaveLength(1);
  expect(session.messages.filter(message => message.role === 'assistant')).toHaveLength(0);
  await host.close();
});
