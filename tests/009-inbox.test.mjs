import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { Events } from '../src/events.mjs'
import { Inbox } from '../src/inbox.mjs'

test('恢复队列、修改/删除、双目的地与单次认领', () => {
  const session = new Events('s'), first = new Inbox(session)
  const turn = first.enqueue('old'), step = first.enqueue('steer', 'step')
  first.update(turn, 'new')
  const restored = new Inbox(session)
  assert.equal(restored.claim('step').id, step)
  assert.equal(restored.claim('turn').content, 'new')
  assert.equal(restored.claim('turn'), undefined)
  assert.throws(() => restored.update(turn, 'late'), /已认领/)
})