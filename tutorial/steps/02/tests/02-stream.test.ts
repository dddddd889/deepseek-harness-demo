import { test, expect } from 'bun:test';
import { fakeModel } from '../src/fake-model';
// 错误流不能产生成功终止帧，后续 Loop 会依赖这个约定。
test('正常流有终止帧，出错流没有', async () => {
  const parts = [];
  for await (const part of fakeModel([{ role: 'user', content: '你好' }], [], new AbortController().signal)) parts.push(part);
  expect(parts.at(-1)?.type).toBe('finish');
  const broken = [];
  try {
    for await (const part of fakeModel([{ role: 'user', content: '/error' }], [], new AbortController().signal)) broken.push(part);
  } catch (error) { expect(String(error)).toContain('固定流故障'); }
  expect(broken.some(part => part.type === 'finish')).toBe(false);
});
