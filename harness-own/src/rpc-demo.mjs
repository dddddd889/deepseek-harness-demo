import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline/promises'
import { Peer, framing } from './rpc.mjs'
import { Approvals } from './approval.mjs'

// 默认真人回答；--auto仅用于明确标注的自动验收，不由模型决定审批。
const automatic = process.argv.includes('--auto')
const debugWorker = process.argv.includes('--debug-worker') // 显式开启子进程Inspector。
const rpcTimeout = debugWorker ? 3_600_000 : 40_000 // 调试时允许停在断点。
const workerArgs = debugWorker ? ['--inspect-brk=127.0.0.1:6500/rpc-worker-032'] : [] // 与主进程6499分开。
const workerEnv = { ...process.env } // 不继承主进程的Inspector地址。
delete workerEnv.BUN_INSPECT
delete workerEnv.BUN_INSPECT_NOTIFY
const temporaryRoot = fileURLToPath(new URL('../tmp/', import.meta.url)) // 固定项目tmp目录，不依赖启动时的cwd。
await mkdir(temporaryRoot, { recursive: true }) // mkdtemp不会自动创建父目录。
const root = await mkdtemp(join(temporaryRoot, 'rpc-032-')) // 只在本次随机子目录里演示删除。
const controller = new AbortController() // 进程断开时取消尚在等待的审批。
const input = automatic ? undefined : createInterface({ input: process.stdin, output: process.stdout })
const answers = [] // 保留实际审批结果供验收。
const child = spawn(process.execPath, [...workerArgs, fileURLToPath(new URL('./rpc-worker.mjs', import.meta.url)), root], {
  stdio: ['pipe', 'pipe', 'pipe'], env: workerEnv,
})
const ended = new Promise(resolve => {
  child.once('close', (code, signal) => resolve({ code, signal }))
  child.once('error', error => resolve({ error: error.message }))
})
let diagnostics = '' // 有界保存子进程诊断。
child.stderr.on('data', chunk => { diagnostics = (diagnostics + chunk).slice(-4096); if (debugWorker) process.stderr.write(chunk) })
const peer = framing(new Peer(), child.stdout, child.stdin)
child.on('error', () => peer.close())
child.on('close', () => { peer.close(); controller.abort() })
// 复用023的一次性审批管理；发布时开始问用户，答复后才唤醒请求。
const approvals = new Approvals(event => {
  if (event.type !== 'approval/request') return
  console.log('外部工具反向请求审批：删除 ' + event.question.path)
  void (async () => {
    const allowed = automatic
      ? event.question.path === 'allow.txt'
      : (await input.question('允许吗？输入 y 才允许：', { signal: controller.signal })).trim() === 'y'
    approvals.answer('demo', event.id, allowed)
  })().catch(() => controller.abort())
})
peer.handle('approval/request', async question => {
  const allowed = await approvals.request('demo', question, controller.signal, rpcTimeout)
  answers.push({ path: question.path, allowed })
  console.log('审批答复：' + (allowed ? '允许' : '拒绝'))
  return { allowed }
})
try {
  await writeFile(join(root, 'allow.txt'), '可删除')
  await writeFile(join(root, 'deny.txt'), '必须保留')
  const sum = await peer.request('tools/call', { name: 'sum', arguments: { a: 2, b: 3 } }, rpcTimeout)
  assert.equal(sum.value, 5); assert.notEqual(sum.pid, process.pid)
  console.log('跨进程sum：' + sum.value)
  const results = [] // 两次调用各有独立请求ID，审批有另外的请求ID。
  for (const path of ['allow.txt', 'deny.txt']) {
    const result = await peer.request('tools/call', { name: 'delete', arguments: { path } }, rpcTimeout)
    if (result.deleted) await assert.rejects(readFile(join(root, path)), { code: 'ENOENT' })
    else assert.ok((await readFile(join(root, path), 'utf8')).length > 0)
    results.push({ path, ...result })
  }
  await assert.rejects(peer.request('missing', {}), /未知方法/)
  child.stdin.end() // EOF让worker退出；不是只发信号便假定清理完成。
  const exit = await ended
  assert.equal(exit.code, 0, diagnostics)
  assert.equal(peer.pending.size, 0); assert.equal(approvals.pending.size, 0)
  console.log('032验收结果：' + JSON.stringify({ automatic, separateProcess: sum.pid !== process.pid, sum: sum.value, answers, results, exitCode: exit.code, rpcPending: peer.pending.size, approvalPending: approvals.pending.size }))
} finally {
  controller.abort(); input?.close(); peer.close(); child.stdin.destroy()
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  await ended
  await rm(root, { recursive: true, force: true })
}
