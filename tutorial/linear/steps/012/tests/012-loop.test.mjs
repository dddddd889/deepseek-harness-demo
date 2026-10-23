import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { Events } from '../src/events.mjs'
import { Tools } from '../src/tools.mjs'
import { Scope } from '../src/scope.mjs'
import { ScriptModel, answer, call } from '../src/model.mjs'
import { runTurn } from '../src/loop.mjs'

test('模型、真实工具、第二次模型构成一轮，调用关联不丢', async () => {
  const session = new Events(), tools = new Tools(), scope = new Scope()
  tools.register(scope, { name: 'sum', description: '加法', schema: { type: 'object' }, run: ({ a, b }) => a + b })
  const model = new ScriptModel([call('sum', { a: 2, b: 3 }), answer('5')])
  const result = await runTurn({ session, tools, model, signal: new AbortController().signal }, '计算')
  assert.equal(result.reason, 'completed')
  assert.equal(model.requests.length, 2)
  assert.deepEqual(model.requests[1].messages.at(-1).content, { ok: true, value: 5 })
  assert.equal(model.requests[1].messages.at(-1).callId, 'call-1')
  assert.equal(session.read().filter(event => event.type === 'turn/end').length, 1)
  await scope.close()
})
