import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { HarnessSDK } from '../src/sdk.mjs'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('SDK真实启动子进程，通知、结果与持久事实一致，退出回收', async () => {
  const root = mkdtempSync(join(tmpdir(), 'own-sdk-')), env = { ...process.env }; delete env.DEEPSEEK_API_KEY
  // 即使工作目录存在模型配置，也不能覆盖调用方删除密钥后的离线选择。
  writeFileSync(join(root, '.env'), 'DEEPSEEK_API_KEY=fixture-not-a-real-key\n')
  const sdk = new HarnessSDK({ home: root, cwd: root, env })
  try {
    const header = await sdk.create(), events = []
    const result = await sdk.run(header.id, 'hello', event => events.push(event))
    assert.equal(result.ending.reason, 'completed'); assert.match(result.text, /hello/)
    assert.ok(events.some(event => event.type === 'turn/end'))
  } finally { await sdk.close(); rmSync(root, { recursive: true, force: true }) }
  assert.equal(sdk.child.exitCode, 0)
})
