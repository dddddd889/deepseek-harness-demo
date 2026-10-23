import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { Shell } from '../src/shell.mjs'

test('真实持久 shell 跨调用保留环境，取消后完整回收', async () => {
  const shell = new Shell(process.cwd()), signal = new AbortController().signal
  try {
    await shell.run('export HARNESS_PROOF=kept', signal)
    assert.match((await shell.run('printf "$HARNESS_PROOF"', signal)).output, /kept/)
    const controller = new AbortController(), pending = shell.run('sleep 60', controller.signal)
    setTimeout(() => controller.abort(), 20)
    await assert.rejects(pending, /取消/)
  } finally { await shell.close() }
})
