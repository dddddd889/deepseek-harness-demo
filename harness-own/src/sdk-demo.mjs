import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { HarnessSDK } from './sdk.mjs'

// 每次演示使用独立目录；退出后保留日志，方便查看 Host 实际保存的事件。
const temporaryRoot = resolve('tmp')
mkdirSync(temporaryRoot, { recursive: true })
const home = mkdtempSync(join(temporaryRoot, 'sdk-044-'))

// 演示固定走离线模型，避免当前终端的真实密钥触发外部请求；不修改父进程环境。
const env = { ...process.env }
delete env.DEEPSEEK_API_KEY
const sdk = new HarnessSDK({ home, cwd: process.cwd(), env })
let notificationCount = 0

try {
  console.log('SDK 调用方 PID：', process.pid)
  console.log('Host 子进程 PID：', sdk.child.pid)
  assert.notEqual(sdk.child.pid, process.pid)

  // create 通过 stdio 请求子进程创建会话；调用方没有直接 new Host。
  const header = await sdk.create()
  console.log('会话 ID：', header.id)

  // run 组合订阅、提交、等待和读取；通知回调发生在本进程。
  const result = await sdk.run(header.id, '你好，044 SDK', event => {
    notificationCount++
    console.log('收到通知：', event.type)
  })
  console.log('最终回复：', result.text)
  console.log('结束原因：', result.ending.reason)
  console.log('收到通知数：', notificationCount)
  console.log('读回事件数：', result.events.length)
  assert.equal(result.text, '[离线演示] 你好，044 SDK')
  assert.equal(result.ending.reason, 'completed')
  assert.ok(notificationCount > 0)
} finally {
  // 关闭 stdin 发送 EOF，等待子进程释放 Host，再核对真实退出码。
  await sdk.close()
}

console.log('Host 子进程退出码：', sdk.child.exitCode)
assert.equal(sdk.child.exitCode, 0)
console.log('本次数据目录：', home)
