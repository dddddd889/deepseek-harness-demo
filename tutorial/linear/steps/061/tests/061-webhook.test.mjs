import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { webhook } from '../src/webhook.mjs'
import { Events } from '../src/events.mjs'

test('签名防篡改，重建接收器仍按持久Inbox身份去重', () => {
  let pumps = 0
  const record = { session: new Events(), agent: { pump: () => pumps++ } }, body = Buffer.from('{"prompt":"review"}')
  const headers = { timestamp: Date.now(), delivery: 'delivery-1', signature: 'sha256=' + createHmac('sha256', 'secret').update(body).digest('hex') }
  assert.equal(webhook({ secret: 'secret' })(record, body, headers).duplicate, false)
  assert.equal(webhook({ secret: 'secret' })(record, body, headers).duplicate, true)
  assert.equal(pumps, 1)
  assert.throws(() => webhook({ secret: 'secret' })(record, Buffer.from('changed'), headers), /签名/)
})
