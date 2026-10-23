import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Host } from '../src/host.mjs'

test('现有模块组合成真实持久Host，双会话隔离、关闭与恢复', async () => {
  const root = mkdtempSync(join(tmpdir(), 'own-host-')), host = new Host(root)
  try {
    const a = host.create({ cwd: root, owner: 'a' }), b = host.create({ cwd: root, owner: 'b' })
    a.agent.submit('hi'); await a.agent.idle()
    assert.throws(() => host.open(a.header.id, 'b'), /权限/)
    await host.closeSession(a.header.id, 'a')
    assert.equal(host.loaded.size, 1)
    const restored = host.open(a.header.id, 'a')
    assert.ok(restored.session.read().some(event => event.type === 'message/assistant'))
    assert.equal(host.list('a').length, 1)
  } finally { await host.close(); rmSync(root, { recursive: true, force: true }) }
})

test('真实持久化失败后，退出仍清理所有会话与资源', async () => {
  const root = mkdtempSync(join(tmpdir(), 'own-host-failure-'))
  let broken
  const host = new Host(root, () => ({ async *stream() {
    yield { kind: 'text', text: 'partial' }
    broken.session.persist = () => { throw Error('disk full') }
    yield { kind: 'finish', reason: 'stop' }
  } }))
  let disposed = 0
  try {
    broken = host.create({ cwd: root }); broken.scope.own(() => disposed++)
    const other = host.create({ cwd: root }); other.scope.own(() => disposed++)
    broken.agent.submit('fail')
    await assert.rejects(broken.agent.idle(), /disk full/)
    await assert.rejects(host.close(), AggregateError)
    assert.equal(disposed, 2); assert.equal(host.loaded.size, 0)
  } finally { await host.close(); rmSync(root, { recursive: true, force: true }) }
})
