import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { hooks } from '../src/hooks.mjs'
import { Tools } from '../src/tools.mjs'
import { Scope } from '../src/scope.mjs'

test('真实Hook子进程拒绝执行，修改后参数仍重新校验', async () => {
  const scope = new Scope(), tools = new Tools(); let executed = false
  tools.register(scope, { name: 'x', schema: { type: 'object' }, run: () => { executed = true } })
  const remove = hooks(tools, { enabled: true, command: process.execPath, args: ['-e', 'console.log(JSON.stringify({allow:false}))'] })
  await assert.rejects(tools.execute({ name: 'x', arguments: {} }, { signal: new AbortController().signal }), /Hook拒绝/)
  assert.equal(executed, false); remove(); await scope.close()
})
