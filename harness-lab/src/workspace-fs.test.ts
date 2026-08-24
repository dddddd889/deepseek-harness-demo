import assert from 'node:assert/strict'
import { test } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ToolRegistry } from './tools.ts'
import { createWorkspaceFsTools, WorkspaceFs } from './workspace-fs.ts'

/** 在系统临时目录创建隔离工作区，并在断言后可靠清理。 */
async function fixture(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'harness-fs-test-'))
  try { await run(root) }
  finally { await rm(root, { recursive: true, force: true }) }
}

test('原子写入、读取与列举使用工作区相对路径', async () => fixture(async root => {
  const fs = await WorkspaceFs.open(root)
  assert.deepEqual(await fs.writeText('src/a.txt', 'hello'), { path: 'src/a.txt', bytes: 5 })
  assert.deepEqual(await fs.readText('src/a.txt'), { path: 'src/a.txt', content: 'hello', truncated: false })
  assert.deepEqual(await fs.list('src'), { path: 'src', entries: [{ name: 'a.txt', type: 'file' }] })
  assert.equal(await readFile(join(root, 'src/a.txt'), 'utf8'), 'hello')
}))

test('拒绝上级路径、绝对路径和读取符号链接逃逸', async () => fixture(async root => {
  const outside = await mkdtemp(join(tmpdir(), 'harness-fs-outside-'))
  try {
    await writeFile(join(outside, 'secret.txt'), 'secret')
    await symlink(outside, join(root, 'escape'))
    const fs = await WorkspaceFs.open(root)
    await assert.rejects(fs.readText('../secret.txt'), errorCode('PATH_OUTSIDE_WORKSPACE'))
    await assert.rejects(fs.readText(join(outside, 'secret.txt')), errorCode('PATH_OUTSIDE_WORKSPACE'))
    await assert.rejects(fs.readText('escape/secret.txt'), errorCode('PATH_OUTSIDE_WORKSPACE'))
  } finally {
    await rm(outside, { recursive: true, force: true })
  }
}))

test('拒绝通过符号链接父目录向工作区外写入', async () => fixture(async root => {
  const outside = await mkdtemp(join(tmpdir(), 'harness-fs-write-outside-'))
  try {
    await symlink(outside, join(root, 'escape'))
    const fs = await WorkspaceFs.open(root)
    await assert.rejects(fs.writeText('escape/pwned.txt', 'no'), errorCode('PATH_OUTSIDE_WORKSPACE'))
    await assert.rejects(readFile(join(outside, 'pwned.txt')), /ENOENT/)
  } finally {
    await rm(outside, { recursive: true, force: true })
  }
}))

test('读取硬上限与展示裁剪是两个不同信号', async () => fixture(async root => {
  await writeFile(join(root, 'large.txt'), '123456')
  const hardLimit = await WorkspaceFs.open(root, { maxReadBytes: 5 })
  await assert.rejects(hardLimit.readText('large.txt'), errorCode('READ_LIMIT_EXCEEDED'))
  const clipped = await WorkspaceFs.open(root, { maxReadBytes: 10, maxOutputChars: 3 })
  assert.deepEqual(await clipped.readText('large.txt'), { path: 'large.txt', content: '123', truncated: true })
}))

test('搜索不跟随符号链接，并对结果数量显式截断', async () => fixture(async root => {
  await mkdir(join(root, 'src'))
  await writeFile(join(root, 'src/a.txt'), 'needle one\nneedle two\n')
  await writeFile(join(root, 'src/b.txt'), 'needle three\n')
  await symlink(join(root, 'src'), join(root, 'alias'))
  const fs = await WorkspaceFs.open(root, { maxSearchResults: 2 })
  const result = await fs.search('needle')
  assert.equal(result.matches.length, 2)
  assert.equal(result.truncated, true)
  assert.equal(result.matches.every(match => !match.path.startsWith('alias/')), true)
}))

test('文件工具通过注册表保留工作区文件系统的稳定错误码', async () => fixture(async root => {
  const fs = await WorkspaceFs.open(root)
  const registry = new ToolRegistry()
  for (const tool of createWorkspaceFsTools(fs)) registry.register(tool)
  const prepared = registry.prepare({ type: 'tool-call', id: 'r1', name: 'fs_read', arguments: '{"path":"../x"}' })
  assert.equal('mode' in prepared, true)
  if ('mode' in prepared) {
    const outcome = await registry.execute(prepared, new AbortController().signal)
    assert.equal(outcome.error?.code, 'PATH_OUTSIDE_WORKSPACE')
  }
}))

/** 构造只检查稳定错误码的拒绝断言函数。 */
function errorCode(code: string): (error: unknown) => boolean {
  return error => typeof error === 'object' && error !== null && 'code' in error && error.code === code
}
