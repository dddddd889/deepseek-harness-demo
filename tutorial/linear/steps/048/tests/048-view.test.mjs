import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { View } from '../src/view.mjs'

test('快照与通知交错不重复，旧连接不污染新视图，审批迟答不复活', () => {
  const view = new View(), first = view.reconnect()
  const events = [{ seq: 0, type: 'stream/text', data: { requestId: 'r', text: 'a' } }, { seq: 1, type: 'approval/request', data: { id: 'p' } }, { seq: 2, type: 'approval/settled', data: { id: 'p' } }]
  view.apply(events[1], first); view.apply(events[0], first); view.apply(events[0], first)
  assert.equal(view.state().text, 'a')
  const second = view.reconnect(); view.apply(events[2], first)
  assert.equal(view.state().approvals.length, 1)
  view.apply(events[2], second); assert.equal(view.state().approvals.length, 0)
})
