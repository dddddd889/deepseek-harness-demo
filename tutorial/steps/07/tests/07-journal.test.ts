import { test, expect } from 'bun:test';
import { mkdtemp, appendFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Session } from '../src/session';
// 模拟半行写入和中间损坏；只有末尾半行允许修复。
test('重建历史并清理崩溃尾行，中间损坏直接失败', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'harness-log-'));
  try {
    const first = new Session('s1', dir);
    first.emit('t1', 'messages', { messages: [{ role: 'user', content: '你好' }] });
    await appendFile(join(dir, 's1.jsonl'), '{"seq":');
    const restored = new Session('s1', dir);
    expect(restored.messages).toEqual(first.messages);
    restored.emit('t1', 'done', { reason: 'cancelled' });
    expect(new Session('s1', dir).events).toHaveLength(2);
    await appendFile(join(dir, 's1.jsonl'), 'broken\n');
    expect(() => new Session('s1', dir)).toThrow();
  } finally { await rm(dir, { recursive: true, force: true }); }
});
