import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { Settings, compose } from '../src/config.mjs'

test('请求快照稳定，后续设置只影响下一请求', () => {
  const settings = new Settings({ route: { model: 'a' } }), first = settings.snapshot()
  settings.set({ route: { model: 'b' } })
  assert.equal(first.route.model, 'a')
  assert.throws(() => { first.route.model = 'bad' }, TypeError)
  assert.equal(settings.snapshot().route.model, 'b')
  assert.equal(compose([{ id: 'a', name: 'fs' }], [{ id: 'a', name: 'fs', enabled: false }])[0].enabled, false)
})