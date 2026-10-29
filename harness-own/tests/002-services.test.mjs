import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { Services } from '../src/services.mjs'
import { Scope } from '../src/scope.mjs'

test('提供方可替换，子会话覆盖不污染父服务', async () => {
  const root = new Services(), owner = new Scope(), child = root.child(), local = new Scope()
  root.provide(owner, 'fs', { read: () => 'local' })
  child.provide(local, 'fs', { read: () => 'remote' })
  assert.equal(child.get('fs').read(), 'remote')
  assert.equal(root.get('fs').read(), 'local')
  await local.close()
  assert.equal(child.get('fs').read(), 'local')
  await owner.close()
  assert.throws(() => child.get('fs'), /缺少/)
})

test('提供方可替换，子会话覆盖不污染父服务2', async () => {
  const root = new Services(), owner = new Scope(), child = root.child(), local = new Scope(), local2 = new Scope(), child2 = root.child()
  root.provide(owner, 'fs', { read: () => 'local' })
  child.provide(local, 'fs', { read: () => 'remote' })
  child2.provide(local2, 'fs2', { read: () => 'remote2' })
  assert.equal(child.get('fs').read(), 'remote')
  assert.equal(root.get('fs').read(), 'local')
  await local.close()
  assert.equal(child.get('fs').read(), 'local')
  assert.equal(child2.get('fs2').read(), 'remote2')
  await owner.close()
  assert.throws(() => child.get('fs'), /缺少/)
})