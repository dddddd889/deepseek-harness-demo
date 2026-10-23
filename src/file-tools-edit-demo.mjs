import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { LocalFS } from './filesystem.mjs'
import { Tools } from './tools.mjs'
import { Scope } from './scope.mjs'
import { fileTools } from './file-tools.mjs'

// 只操作新建临时目录，不修改学习者自己的文件。
const root = await mkdtemp(join(tmpdir(), 'edit-022-')), scope = new Scope()
const fs = new LocalFS(root), tools = new Tools(), context = { signal: new AbortController().signal }
try {
  fileTools(scope, tools, fs)
  console.log('演示目录：' + root)
  await tools.execute({ name: 'write', arguments: { path: 'a.txt', text: 'x x' } }, context)
  const original = await tools.execute({ name: 'read', arguments: { path: 'a.txt' } }, context)
  // 不传replaceAll：两个x必须被拒绝，而不是悄悄替换其中一个或全部。
  await assert.rejects(tools.execute({ name: 'edit', arguments: { path: 'a.txt', before: 'x', after: 'y', version: original.version } }, context), /唯一/)
  assert.equal((await fs.read('a.txt')).text, 'x x')
  console.log('默认多匹配：拒绝；文件仍为 x x', (await fs.read('a.txt')).version)
  // 明确传布尔true：同一版本的两个x全部替换为y。
  await tools.execute({ name: 'edit', arguments: { path: 'a.txt', before: 'x', after: 'y', version: original.version, replaceAll: true } }, context)
  assert.equal((await fs.read('a.txt')).text, 'y y')
  console.log('replaceAll=true：成功；文件变为 y y', (await fs.read('a.txt')).version)
  // 每次写入后重新读取版本，旧版本不能用于下一次全量替换。
  await assert.rejects(tools.execute({ name: 'edit', arguments: { path: 'a.txt', before: 'y', after: 'z', version: original.version, replaceAll: true } }, context), /版本冲突/)
  console.log('沿用旧版本：拒绝；文件仍为 y y', (await fs.read('a.txt')).version)
  const current = await tools.execute({ name: 'read', arguments: { path: 'a.txt' } }, context)
  // 用更具体、只出现一次的before，省略replaceAll仍可执行唯一替换。
  await tools.execute({ name: 'edit', arguments: { path: 'a.txt', before: 'y ', after: 'z ', version: current.version } }, context)
  assert.equal((await fs.read('a.txt')).text, 'z y')
  console.log('重新读取后唯一替换：成功；文件变为 z y', (await fs.read('a.txt')).version)
} finally { await scope.close(); await rm(root, { recursive: true, force: true }) }
console.log('演示完成，临时文件及工具注册已清理。')