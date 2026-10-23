import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { batch } from '../src/batch.mjs'
import { setTimeout as delay } from 'node:timers/promises'

test('并发完成顺序可变，结果按调用顺序；独占形成屏障', async () => {
  const order = []
  const results = await batch([{ id: 0 }, { id: 1 }, { id: 2, exclusive: true }, { id: 3 }], call => !!call.exclusive, async call => {
    order.push('start' + call.id); await delay(call.id === 0 ? 15 : 1); order.push('end' + call.id); return call.id
  })
  assert.deepEqual(results.map(result => result.value), [0, 1, 2, 3])
  assert.ok(order.indexOf('start2') > order.indexOf('end0'))
  assert.ok(order.indexOf('start3') > order.indexOf('end2'))
})
