import { test, expect } from 'bun:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Tools } from '../src/tools';
import { registerDiagnostics } from '../src/lsp';
// 同一坏文件先报错，修正后为空；结果来自另一个进程中的 TypeScript 编译器。
test('LSP 真进程诊断坏语法并验证修正', async () => {
  const root = await mkdtemp(join(tmpdir(), 'harness-lsp-'));
  try {
    const tools = new Tools(); registerDiagnostics(tools, root);
    const check = () => tools.execute({ id: 'c', type: 'function', function: { name: 'diagnostics', arguments: '{"path":"bad.ts"}' } }, new AbortController().signal);
    await writeFile(join(root, 'bad.ts'), 'const x = ;');
    expect(JSON.parse(await check()).items.length).toBeGreaterThan(0);
    await writeFile(join(root, 'bad.ts'), 'const x = 1;');
    expect(JSON.parse(await check()).items).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 10_000);
