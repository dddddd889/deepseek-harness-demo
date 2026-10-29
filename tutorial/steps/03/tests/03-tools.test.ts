import { test, expect } from 'bun:test';
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Tools, registerRead } from '../src/tools';
// 使用真实临时文件验证边界，结束后删除临时目录。
test('工具读取、越界和卸载', async () => {
  const root = await mkdtemp(join(tmpdir(), 'harness-read-'));
  try {
    await writeFile(join(root, 'README.md'), '你好');
    await symlink(tmpdir(), join(root, 'outside'));
    const tools = new Tools();
    const dispose = registerRead(tools, root);
    const call = (path: string) => tools.execute({ id: 'c1', type: 'function', function: { name: 'read', arguments: JSON.stringify({ path }) } }, new AbortController().signal);
    expect(await call('README.md')).toBe('你好');
    await expect(call('../secret')).rejects.toThrow('越界');
    await expect(call('outside')).rejects.toThrow('越界');
    dispose();
    expect(tools.specs()).toHaveLength(0);
  } finally { await rm(root, { recursive: true, force: true }); }
});
