import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, symlink, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalFS } from '../src/filesystem.mjs'

test('真实文件先读后改、旧版本拒绝、符号链接越界拒绝', async () => {
  const root = await mkdtemp(join(tmpdir(), 'own-fs-'))
  try {
    await mkdir(join(root, 'workspace')); await writeFile(join(root, 'outside'), 'secret')
    const fs = new LocalFS(join(root, 'workspace'))
    await fs.write('中文 a.txt', 'one')
    const observed = await fs.read('中文 a.txt')
    await fs.write('中文 a.txt', 'two', observed.version)
    await assert.rejects(fs.write('中文 a.txt', 'stale', observed.version), /变化|读取/)
    await symlink(join(root, 'outside'), join(root, 'workspace', 'link'))
    await assert.rejects(fs.read('link'), /越出/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
