import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { execute } from '../src/process.mjs'

test('真实进程非零退出、输出超限、超时和取消', async () => {
  const signal = new AbortController().signal
  const result = await execute({ command: process.execPath, args: ['-e', 'console.log("ok");process.exit(3)'] }, signal)
  assert.equal(result.code, 3); assert.match(result.output, /ok/)
  await assert.rejects(execute({ command: process.execPath, args: ['-e', 'console.log("x".repeat(100000))'] }, signal), /超限/)
  await assert.rejects(execute({ command: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'], timeout: 30 }, signal), /超时/)
  const controller = new AbortController(), pending = execute({ command: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'] }, controller.signal)
  controller.abort(); await assert.rejects(pending, /取消/)
})