import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { permissionGuard } from '../src/permissions.mjs'
import { Settings } from '../src/config.mjs'
import { Events } from '../src/events.mjs'
import { Approvals } from '../src/approval.mjs'
import { Tools } from '../src/tools.mjs'
import { Scope } from '../src/scope.mjs'

test('执行工具统一过守卫，拒绝后没有副作用', async () => {
  const tools = new Tools(), scope = new Scope(), settings = new Settings({ permission: 'ask' }), session = new Events('s')
  let writes = 0
  const approvals = new Approvals(event => { if (event.type === 'approval/request') approvals.answer('s', event.id, false) })
  tools.guard = permissionGuard(settings, approvals)
  tools.register(scope, { name: 'write', effect: 'write', schema: { type: 'object' }, run: () => writes++ })
  await assert.rejects(tools.execute({ name: 'write', arguments: {} }, { session, signal: new AbortController().signal }), /用户拒绝/)
  assert.equal(writes, 0)
  settings.set({ permission: 'read-only' })
  await assert.rejects(tools.execute({ name: 'write', arguments: {} }, { session, signal: new AbortController().signal }), /只读/)
  await scope.close()
})
