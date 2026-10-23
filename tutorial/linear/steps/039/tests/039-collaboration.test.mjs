import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { Collaboration } from '../src/collaboration.mjs'
import { Events } from '../src/events.mjs'
import { messages } from '../src/projection.mjs'

test('提醒重建后不重复投递，反馈不进入模型历史', async () => {
  const session = new Events(), first = new Collaboration(session), delivered = []
  first.set('schedule', { id: 's', at: 1, text: 'review', status: 'pending' })
  await first.due(2, async id => delivered.push(id))
  await new Collaboration(session).due(3, async id => delivered.push(id))
  assert.deepEqual(delivered, ['s'])
  first.feedback(0, 'up', 'good'); assert.equal(messages(session.read()).length, 0)
  assert.throws(() => first.set('plan', { id: 'p', status: 'completed' }), /不合法/)
})
