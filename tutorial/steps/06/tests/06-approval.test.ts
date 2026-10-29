import { test, expect } from 'bun:test';
import { Approvals } from '../src/approval';
// 验证取消会释放等待者，并阻止旧按钮在取消后授权。
test('审批只能处理一次且属于指定会话', async () => {
  const approvals = new Approvals();
  const controller = new AbortController();
  let id = '';
  const promise = approvals.request('s1', { id: 'c1', type: 'function', function: { name: 'write', arguments: '{}' } },
    controller.signal, (type, data) => { if (type === 'approval') id = data.id; });
  expect(() => approvals.decide('s2', id, true)).toThrow('失效');
  controller.abort();
  await expect(promise).rejects.toBeDefined();
  expect(approvals.size()).toBe(0);
  expect(() => approvals.decide('s1', id, true)).toThrow('失效');
});
