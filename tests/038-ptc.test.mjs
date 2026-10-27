import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { runProgram } from '../src/ptc.mjs'
import { Tools } from '../src/tools.mjs'
import { Scope } from '../src/scope.mjs'

test('内层工具也经过守卫，预算先检查', async () => {
  const scope = new Scope(), tools = new Tools(), context = { signal: new AbortController().signal }; let checks = 0
  tools.guard = async () => { checks++ }
  tools.register(scope, { name: 'echo', schema: { type: 'object' }, run: args => args.text })
  const result = await runProgram([{ id: 'a', tool: 'echo', arguments: { text: 'ok' } }, { id: 'b', tool: 'echo', arguments: { text: { $ref: 'a' } } }], tools, context)
  assert.equal(result.b, 'ok'); assert.equal(checks, 2)
  await assert.rejects(runProgram([{}], tools, context, 0), /预算/)
  await scope.close()
})