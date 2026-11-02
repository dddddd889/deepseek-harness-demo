import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'

// 单独运行真实GUI烟测；它不藏在每一步bun test里反复弹出窗口。
const require = createRequire(import.meta.url), packageRoot = dirname(require.resolve('electron/package.json'))
let relative
try { relative = readFileSync(join(packageRoot, 'path.txt'), 'utf8') }
catch { throw Error('先执行 bun scripts/install-electron.mjs，不能把没下载二进制当应用启动成功') }
const executable = join(packageRoot, 'dist', relative), data = mkdtempSync(join(tmpdir(), 'harness-desktop-smoke-'))
const environment = { ...process.env, HARNESS_DESKTOP_USER_DATA: data, HARNESS_BUN: process.execPath }
delete environment.ELECTRON_RUN_AS_NODE; delete environment.DEEPSEEK_API_KEY
const child = spawn(executable, [resolve('desktop/main.cjs'), '--remote-debugging-port=0'], { env: environment, stdio: ['ignore', 'pipe', 'pipe'] }), exited = once(child, 'close')
let logs = '', ws, serial = 0
const waiting = new Map()
child.stdout.resume(); child.stderr.on('data', bytes => { logs = (logs + bytes.toString()).slice(-8000) })
/** CDP只用于测试，不给Renderer开放任意宿主执行。 */
function request(method, params = {}, sessionId = undefined) {
  const id = ++serial
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { waiting.delete(id); reject(Error('CDP超时：' + method)) }, 5000)
    waiting.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
  })
}
try {
  const deadline = Date.now() + 25_000
  let endpoint
  while (Date.now() < deadline && !endpoint && child.exitCode === null) { endpoint = /DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+)/.exec(logs)?.[1]; await delay(100) }
  if (!endpoint) throw Error('Electron调试入口未就绪')
  ws = new WebSocket(endpoint); await once(ws, 'open')
  ws.addEventListener('message', event => {
    const value = JSON.parse(event.data), pending = waiting.get(value.id)
    if (!pending) return
    clearTimeout(pending.timer); waiting.delete(value.id)
    if (value.error) pending.reject(Error(value.error.message)); else pending.resolve(value.result)
  })
  let target
  while (Date.now() < deadline) { const result = await request('Target.getTargets'); target = result.targetInfos.find(item => item.type === 'page' && item.url.startsWith('http://127.0.0.1:')); if (target) break; await delay(100) }
  if (!target) throw Error('Host页面未就绪')
  const { sessionId } = await request('Target.attachToTarget', { targetId: target.targetId, flatten: true })
  let value
  while (Date.now() < deadline) {
    try {
      const result = await request('Runtime.evaluate', { expression: '(async()=>({title:document.title,info:window.desktop?await window.desktop.info():null,requireType:typeof window.require,ready:!!document.querySelector("#create")}))()', awaitPromise: true, returnByValue: true }, sessionId)
      value = result.result.value
      if (value?.ready && value.info) break
    } catch {}
    await delay(100)
  }
  if (!value?.ready || value.requireType !== 'undefined' || !value.info.platform) throw Error('桌面桥或Renderer隔离验收失败')
  mkdirSync('.evidence', { recursive: true }); writeFileSync('.evidence/desktop-smoke.json', JSON.stringify(value, null, 2) + '\n')
  console.log(JSON.stringify(value, null, 2))
} finally {
  ws?.close(); for (const item of waiting.values()) { clearTimeout(item.timer); item.reject(Error('测试结束')) }
  child.kill('SIGTERM'); const force = setTimeout(() => child.kill('SIGKILL'), 7000); await exited; clearTimeout(force)
  rmSync(data, { recursive: true, force: true })
}
