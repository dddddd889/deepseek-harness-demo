import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { Approvals } from '../src/approval.mjs'

test('同步答复、跨会话拒绝、取消清理和迟答失效', async () => {
  const events = [], signal = new AbortController()
  const approvals = new Approvals(event => events.push(event))
  const promise = approvals.request('s1', 'write?', signal.signal)
  const requestId = events[0].id
  assert.throws(() => approvals.answer('s2', requestId, true), /不属于/)
  signal.abort()
  await assert.rejects(promise, /取消/)
  assert.equal(approvals.pending.size, 0)
  assert.throws(() => approvals.answer('s1', requestId, true), /不存在/)
  const immediate = new Approvals(event => { if (event.type === 'approval/request') immediate.answer('s', event.id, true) })
  assert.equal(await immediate.request('s', 'yes?', new AbortController().signal), true)
})
