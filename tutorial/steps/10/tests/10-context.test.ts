import { test, expect } from 'bun:test';
import { prepareContext } from '../src/context';
// 删除旧 turn 时，调用和结果必须一起移除。
test('上下文裁剪保持工具协议完整，单个巨大 turn 明确失败', () => {
  const old: any[] = [{ role: 'user', content: 'x'.repeat(2000) },
    { role: 'assistant', content: null, tool_calls: [{ id: 'c', type: 'function', function: { name: 'read', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'c', content: '旧结果' }];
  const input: any[] = [...old, { role: 'user', content: '新任务' }];
  expect(prepareContext(input, '规则', 500)).toHaveLength(2);
  expect(input).toHaveLength(4);
  expect(() => prepareContext([{ role: 'user', content: 'x'.repeat(1000) }], '规则', 100)).toThrow('超限');
});
