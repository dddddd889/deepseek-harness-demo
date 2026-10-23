import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { HarnessSDK } from '../src/sdk.mjs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('SDK真实启动子进程，通知、结果与持久事实一致，退出回收', async () => {
  const root = mkdtempSync(join(tmpdir(), 'own-sdk-')), env = { ...process.env }; delete env.DEEPSEEK_API_KEY
  const sdk = new HarnessSDK({ home: root, cwd: root, env })
  try {
    const header = await sdk.create(), events = []
    const result = await sdk.run(header.id, 'hello', event => events.push(event))
    assert.equal(result.ending.reason, 'completed'); assert.match(result.text, /hello/)
    assert.ok(events.some(event => event.type === 'turn/end'))
  } finally { await sdk.close(); rmSync(root, { recursive: true, force: true }) }
})
