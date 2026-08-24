import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { test } from 'bun:test'
import { HarnessBundle } from './bundle.ts'
import type { Plugin } from './context.ts'
import { HeadlessHost } from './headless-host.ts'
import { loadProfile } from './profile.ts'

const execFileAsync = promisify(execFile)

async function spawnWithInput(args: readonly string[], input: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk })
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk })
    child.once('error', reject)
    child.once('exit', code => resolve({ stdout, stderr, code: code ?? -1 }))
    child.stdin.end(input)
  })
}

async function profile(root: string) {
  const path = join(root, 'profile.json')
  await writeFile(path, JSON.stringify({
    name: 'test', provider: 'scripted', model: 'fixture', scriptedResponse: 'fixed answer',
    persistenceRoot: join(root, 'sessions'), cwd: root, apiKeyEnv: 'TEST_KEY',
    maxSteps: 3, sandboxMode: 'read-only', approvalPolicy: 'never',
  }))
  return path
}

test('配置严格拒绝未知字段，并按文件、环境变量、命令行依次覆盖', async () => {
  const root = await mkdtemp(join(tmpdir(), 'harness-profile-'))
  const path = await profile(root)
  const resolved = await loadProfile(path, { DSH_LAB_MODEL: 'env-model', DSH_LAB_SANDBOX: 'workspace-write' }, { model: 'cli-model' })
  assert.equal(resolved.model, 'cli-model')
  assert.equal(resolved.sandboxMode, 'workspace-write')
  await writeFile(path, JSON.stringify({ unknown: true }))
  await assert.rejects(loadProfile(path, {}), /未知字段：unknown/)
})

test('插件包某条目失败时会逆序回滚此前插件', async () => {
  const bundle = new HarnessBundle()
  const disposed: string[] = []
  const plugin = (name: string, fail = false): Plugin => ({
    name,
    apply: async context => {
      await context.effect(() => () => { disposed.push(name) })
      if (fail) throw new Error(`${name} 失败`)
      await context.provide(name, name)
    },
  })
  await assert.rejects(bundle.mount([plugin('a'), plugin('b'), plugin('c', true)]), /c 失败/)
  assert.deepEqual(disposed, ['c', 'b', 'a'])
  assert.deepEqual(bundle.context.inspect(), { services: [], plugins: [], listeners: {} })
})

test('无界面宿主的创建、关闭与冷恢复复用同一智能体和存储语义', async () => {
  const root = await mkdtemp(join(tmpdir(), 'harness-headless-'))
  const resolved = await loadProfile(await profile(root), {})
  const firstHost = await HeadlessHost.open(resolved)
  const first = await firstHost.create('stable')
  assert.equal((await first.run('one')).turn, 1)
  await first.close(); await firstHost.dispose()

  const secondHost = await HeadlessHost.open(resolved)
  const second = await secondHost.resume('stable')
  const resumed = await second.run('two')
  assert.equal(resumed.turn, 2)
  assert.equal(resumed.text, 'fixed answer')
  await second.close(); await secondHost.dispose()
})

test('命令行独立进程创建后可以恢复，JSONL 输出携带连续轮次', async () => {
  const root = await mkdtemp(join(tmpdir(), 'harness-cli-'))
  const path = await profile(root)
  const entry = join(import.meta.dirname, 'cli-entry.ts')
  const first = await execFileAsync(process.execPath, [entry, '--profile', path, '--session', 'cli-stable', '--json', 'first'])
  const second = await execFileAsync(process.execPath, [entry, '--profile', path, '--resume', 'cli-stable', '--json', 'second'])
  assert.equal(JSON.parse(first.stdout).turn, 1)
  assert.equal(JSON.parse(second.stdout).turn, 2)
  assert.equal(JSON.parse(second.stdout).sessionId, 'cli-stable')
})

test('命令行交互模式在一个对话内逐行运行', async () => {
  const root = await mkdtemp(join(tmpdir(), 'harness-cli-interactive-'))
  const path = await profile(root)
  const entry = join(import.meta.dirname, 'cli-entry.ts')
  const result = await spawnWithInput([entry, '--profile', path, '--session', 'interactive', '--interactive', '--json'], 'first\nsecond\n')
  assert.equal(result.code, 0, result.stderr)
  const turns = result.stdout.trim().split('\n').map(line => JSON.parse(line).turn)
  assert.deepEqual(turns, [1, 2])
})
