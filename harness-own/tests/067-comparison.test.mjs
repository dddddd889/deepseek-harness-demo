import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { signature } from '../scripts/compare-acp.mjs'

test('差分只删除随机身份，不吞掉cancelled或partial', () => {
  const result = signature([{ sessionId: 'random', update: { sessionUpdate: 'agent_message_chunk', messageId: 'random', content: { text: 'partial' } } }, { update: { sessionUpdate: 'usage_update' } }], ['cancelled'])
  assert.deepEqual(result, { messages: ['partial'], endings: ['cancelled'] })
})
