import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { Scope } from '../src/scope.mjs'

test('撤销逆序、幂等，异常不阻断剩余清理', async () => {
  const scope = new Scope(), order = []
  scope.own(() => order.push('parent'))
  scope.child().own(() => { order.push('child'); throw Error('broken') })
  await assert.rejects(scope.close(), AggregateError)
  await scope.close()
  assert.deepEqual(order, ['child', 'parent'])
  assert.throws(() => scope.own(() => {}), /已关闭/)
})
