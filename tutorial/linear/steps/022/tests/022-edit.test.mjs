import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { LocalFS } from '../src/filesystem.mjs'
import { Tools } from '../src/tools.mjs'
import { Scope } from '../src/scope.mjs'
import { fileTools } from '../src/file-tools.mjs'

test('模型 edit 消费真实文件提供方，多匹配不做隐式全替换', async () => {
  const root = await mkdtemp(join(tmpdir(), 'own-edit-')), scope = new Scope()
  try {
    const fs = new LocalFS(root), tools = new Tools(), context = { signal: new AbortController().signal }
    fileTools(scope, tools, fs); await fs.write('a', 'x x')
    const { version } = await fs.read('a')
    await assert.rejects(tools.execute({ name: 'edit', arguments: { path: 'a', before: 'x', after: 'y', version } }, context), /唯一/)
    assert.equal((await fs.read('a')).text, 'x x')
  } finally { await scope.close(); await rm(root, { recursive: true, force: true }) }
})
