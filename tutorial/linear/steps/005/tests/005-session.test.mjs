import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createReaderApp } from '../src/session-app.mjs'

/** 读取实际落盘的JSONL，验证磁盘记录和会话事实一致。 */
function records(path) { return readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) }

test('完整装配：真实读文件、配置固定、终端退出、游标补读和应用清理', async () => {
  const root = mkdtempSync(join(tmpdir(), 'reader-app-')) // 隔离工作区与日志。
  const file = join(root, 'README.md'), log = join(root, 'events.jsonl'), observed = []
  writeFileSync(file, '真实 README 内容')
  let settings // 观察者在任务开始后更新设置，检验当前任务是否仍用旧快照。
  const app = await createReaderApp({ logPath: log, display: event => {
    observed.push(event)
    if (event.type === 'tool/start') settings.set({ prefix: '新设置' })
  }, layers: [[{ id: 'settings', name: 'settings', config: { prefix: '个人配置' } }]] })
  const session = app.services.get('session'), task = app.services.get('readTask')
  settings = app.services.get('settings')
  try {
    const first = await task.run(file)
    assert.equal(first.config.revision, 0)
    assert.equal(first.content, '个人配置：\n真实 README 内容')
    assert.equal(settings.snapshot().prefix, '新设置')
    assert.deepEqual(records(log), session.read())
    assert.deepEqual(observed.map(event => event.seq), [0, 1, 2, 3, 4, 5])
    await app.remove('terminal')
    assert.equal(session.listeners.size, 0)
    const second = await task.run(file)
    assert.equal(second.config.revision, 1)
    assert.equal(second.content, '新设置：\n真实 README 内容')
    assert.equal(observed.length, 6)
    assert.deepEqual(session.read(5).map(event => event.seq), [6, 7, 8, 9, 10, 11])
    assert.deepEqual(records(log), session.read())
  } finally { await app.close(); rmSync(root, { recursive: true, force: true }) }
  assert.equal(app.active.size, 0)
  assert.equal(app.services.entries.size, 0)
  await assert.rejects(task.run(file), /已退出/)
})

test('真实读取失败不会产生成功消息，坏展示端不阻断其他观察者', async () => {
  const root = mkdtempSync(join(tmpdir(), 'reader-failure-')), log = join(root, 'events.jsonl'), observed = []
  const app = await createReaderApp({ logPath: log, display: () => { throw Error('展示端异常') } })
  const session = app.services.get('session')
  app.scope.own(session.on(event => observed.push(event))) // 第二个观察者有自己的清理归属。
  try {
    await assert.rejects(app.services.get('readTask').run(join(root, 'missing.md')), /ENOENT/)
    assert.deepEqual(session.read().map(event => event.type), ['turn/start', 'message/user', 'tool/start', 'tool/error', 'turn/end'])
    assert.equal(session.read().at(-1).data.reason, 'error')
    assert.equal(observed.length, 5)
    assert.deepEqual(records(log), session.read())
  } finally { await app.close(); rmSync(root, { recursive: true, force: true }) }
  assert.equal(session.listeners.size, 0)
})
