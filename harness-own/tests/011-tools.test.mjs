import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { Scope } from '../src/scope.mjs'
import { Tools } from '../src/tools.mjs'

test('参数和未知工具在执行前拒绝，撤销后不能继续调用', async () => {
  const scope = new Scope(), tools = new Tools(), context = { signal: new AbortController().signal }
  let runs = 0
  tools.register(scope, { name: 'echo', description: '回声', schema: { type: 'object', required: ['text'], properties: { text: { type: 'string' } }, additionalProperties: false }, run: args => { runs++; return args.text } })
  await assert.rejects(tools.execute({ name: 'echo', arguments: { text: 3 } }, context), /类型/)
  assert.equal(runs, 0)
  assert.equal(await tools.execute({ name: 'echo', arguments: { text: 'ok' } }, context), 'ok')
  await scope.close()
  await assert.rejects(tools.execute({ name: 'echo', arguments: {} }, context), /未知/)
})