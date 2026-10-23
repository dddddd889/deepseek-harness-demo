import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { workflow } from '../src/workflow.mjs'
import { Tools } from '../src/tools.mjs'
import { Scope } from '../src/scope.mjs'

test('有依赖的真实工具执行，循环在副作用前拒绝', async () => {
  const scope = new Scope(), tools = new Tools(), order = [], context = { signal: new AbortController().signal }
  tools.register(scope, { name: 'record', schema: { type: 'object' }, run: args => { order.push(args.id); return args.id } })
  const a = { id: 'a', call: { name: 'record', arguments: { id: 'a' } } }, b = { id: 'b', after: ['a'], call: { name: 'record', arguments: { id: 'b' } } }
  assert.deepEqual(await workflow([b, a], tools, context), { a: 'a', b: 'b' })
  await assert.rejects(workflow([{ ...a, after: ['b'] }, b], tools, context), /循环/)
  assert.deepEqual(order, ['a', 'b']); await scope.close()
})
