import assert from 'node:assert/strict'
import { test } from 'bun:test'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalProcessRuntime, childEnvironment, readSpill } from './local-process.ts'
import { createShellTool, LocalShell } from './local-shell.ts'
import { ToolRegistry } from './tools.ts'

/** 为每个测试创建独立 运行时与工作区，并验证 释放操作可以完成。 */
async function fixture(run: (runtime: LocalProcessRuntime, root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'harness-process-test-'))
  const runtime = await LocalProcessRuntime.create()
  try { await run(runtime, root) }
  finally {
    await runtime.dispose()
    await rm(root, { recursive: true, force: true })
  }
}

test('子进程分别收集标准输出与标准错误，非零退出不是基础设施异常', async () => fixture(async (runtime, root) => {
  const result = await runtime.run({
    argv: [process.execPath, '-e', "process.stdout.write('out');process.stderr.write('err');process.exit(7)"],
    cwd: root,
  })
  assert.equal(result.exitCode, 7)
  assert.equal(result.stdout.text, 'out')
  assert.equal(result.stderr.text, 'err')
  assert.equal(result.timedOut, false)
}))

test('输出超过内存上限时前缀留在结果，完整内容进入溢出存储', async () => fixture(async (runtime, root) => {
  const result = await runtime.run({
    argv: [process.execPath, '-e', "process.stdout.write('0123456789')"], cwd: root, maxOutputBytes: 4,
  })
  assert.deepEqual({ text: result.stdout.text, bytes: result.stdout.bytes, truncated: result.stdout.truncated }, {
    text: '0123', bytes: 10, truncated: true,
  })
  assert.equal(await readSpill(result.stdout), '0123456789')
}))

test('默认环境清洗凭证与 DSH_，显式传入值可以覆盖', () => {
  const secretName = 'HARNESS_LAB_TEST_SECRET'
  const identityName = 'DSH_HARNESS_LAB_TEST'
  const oldSecret = process.env[secretName]
  const oldIdentity = process.env[identityName]
  process.env[secretName] = 'parent-secret'
  process.env[identityName] = 'parent-id'
  try {
    const implicit = childEnvironment()
    assert.equal(implicit[secretName], undefined)
    assert.equal(implicit[identityName], undefined)
    const explicit = childEnvironment({ [secretName]: 'deliberate' })
    assert.equal(explicit[secretName], 'deliberate')
  } finally {
    if (oldSecret === undefined) delete process.env[secretName]
    else process.env[secretName] = oldSecret
    if (oldIdentity === undefined) delete process.env[identityName]
    else process.env[identityName] = oldIdentity
  }
})

test.skipIf(process.platform === 'win32')('超时对拒绝 SIGTERM 的进程升级到 SIGKILL', async () => fixture(async (runtime, root) => {
  const result = await runtime.run({
    argv: [process.execPath, '-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],
    // 给测试负载下的子 Bun 足够时间安装 SIGTERM 信号处理器，再验证升级分支。
    cwd: root, timeoutMs: 250, graceMs: 20,
  })
  assert.equal(result.timedOut, true)
  assert.equal(result.signal, 'SIGKILL')
}))

test('取消信号终止进程并标记为已取消', async () => fixture(async (runtime, root) => {
  const controller = new AbortController()
  const pending = runtime.run({
    argv: [process.execPath, '-e', 'setInterval(()=>{},1000)'], cwd: root, signal: controller.signal, graceMs: 20,
  })
  setTimeout(() => controller.abort(new Error('停止')), 20)
  const result = await pending
  assert.equal(result.aborted, true)
  assert.notEqual(result.signal, null)
}))

test('运行时释放时终止并等待仍存活的后台进程', async () => {
  const root = await mkdtemp(join(tmpdir(), 'harness-dispose-test-'))
  const runtime = await LocalProcessRuntime.create()
  try {
    const handle = runtime.spawn({ argv: [process.execPath, '-e', 'setInterval(()=>{},1000)'], cwd: root, graceMs: 20 })
    await runtime.dispose()
    const outcome = await handle.done
    assert.notEqual(outcome.signal, null)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('终端解释器固定工作目录，命令失败以结果返回', async () => fixture(async (runtime, root) => {
  const shell = new LocalShell(runtime, root)
  const result = await shell.run({ command: 'pwd; printf shell_err >&2; exit 3' })
  assert.equal(result.exitCode, 3)
  assert.equal(result.stdout.text.trim(), await realpath(root))
  assert.equal(result.stderr.text, 'shell_err')
}))

test('终端执行工具返回结构化退出与输出', async () => fixture(async (runtime, root) => {
  const registry = new ToolRegistry()
  registry.register(createShellTool(new LocalShell(runtime, root)))
  const prepared = registry.prepare({
    type: 'tool-call', id: 's1', name: 'shell_exec', arguments: '{"command":"printf tool_ok"}',
  })
  assert.equal('mode' in prepared, true)
  if ('mode' in prepared) {
    const result = await registry.execute(prepared, new AbortController().signal)
    assert.equal(result.isError, false)
    assert.match(result.content[0]?.type === 'text' ? result.content[0].text : '', /tool_ok/)
  }
}))

test.skipIf(process.platform === 'win32')('真实伪终端支持写入、调整尺寸、输出和退出', async () => fixture(async (runtime, root) => {
  const terminal = await new LocalShell(runtime, root).spawnTerminal()
  let output = ''
  const off = terminal.onData(data => { output += data })
  terminal.resize(100, 30)
  terminal.write("printf 'PTY_OK\\n'; exit\n")
  await Promise.race([
    terminal.done,
    new Promise((_, reject) => setTimeout(() => reject(new Error('PTY 测试超时')), 2_000)),
  ])
  off()
  assert.match(output, /PTY_OK/)
}))
