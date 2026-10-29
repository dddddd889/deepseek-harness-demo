import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { Events } from '../src/events.mjs'
import { messages, fork, search } from '../src/projection.mjs'

test('分片不混进模型历史，fork 不改父会话，搜索是冷读', () => {
  const parent = new Events('p'), child = new Events('c')
  parent.append('message/user', { role: 'user', content: '修复取消' })
  parent.append('stream/text', { text: '暂时' })
  fork(parent, child, 1)
  assert.equal(messages(child.read()).length, 1)
  assert.equal(parent.read().length, 2)
  assert.equal(search([parent], '取消')[0].seq, 0)
})