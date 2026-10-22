import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { Events } from '../src/events.mjs'

test('日志失败时不发布；读取者不能篡改已经发布的事实', () => {
  const failed = new Events('s', () => { throw Error('disk full') }), observed = []
  failed.on(event => observed.push(event))
  assert.throws(() => failed.append('user', { text: 'hi' }), /disk full/)
  assert.equal(observed.length, 0)
  assert.equal(failed.read().length, 0)
  const session = new Events('s')
  session.append('user', { text: 'hi' })
  session.read()[0].data.text = 'changed'
  assert.equal(session.read()[0].data.text, 'hi')
})