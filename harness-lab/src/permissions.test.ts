import assert from 'node:assert/strict'
import { test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SandboxMode, ToolDefinition } from './domain.ts'
import { LocalProcessRuntime } from './local-process.ts'
import { LocalShell } from './local-shell.ts'
import { inspectApprovalAudit, PermissionService } from './permissions.ts'
import { inspectLifecycle } from './projections.ts'
import { Session } from './session.ts'
import { executeToolCalls } from './tool-execution.ts'
import { ToolRegistry } from './tools.ts'

/** 创建会记录执行模式的写工具。 */
function writeTool(seen: SandboxMode[]): ToolDefinition {
  return {
    name: 'write', description: '写操作',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        sandbox_permissions: { enum: ['workspace-write', 'danger-full-access'] },
        justification: { type: 'string', minLength: 1 },
      },
    },
    effect: () => ({ minimumMode: 'workspace-write', reason: '测试写操作' }),
    async execute(_args, _signal, context) {
      seen.push(context?.sandboxMode ?? 'danger-full-access')
      return 'written'
    },
  }
}

/** 在未闭合步骤中执行一个工具并闭合日志。 */
async function executeOne(registry: ToolRegistry, permissions: PermissionService, args: string): Promise<Session> {
  const session = new Session()
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  await executeToolCalls(registry, session, 1, 1, [{
    type: 'tool-call', id: 'call-1', name: 'write', arguments: args,
  }], new AbortController().signal, permissions)
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  return session
}

test('只读模式下未请求升级的写工具在执行主体前被拒绝', async () => {
  const seen: SandboxMode[] = []
  const registry = new ToolRegistry()
  registry.register(writeTool(seen))
  const session = await executeOne(registry, new PermissionService({ defaultMode: 'read-only' }), '{}')
  assert.deepEqual(seen, [])
  const result = session.events.find(event => event.type === 'tool/result')
  assert.equal(result?.data.error?.code, 'SANDBOX_DENIED')
  assert.deepEqual(inspectApprovalAudit(session.events), { pending: [], decisions: 0 })
})

test('单次允许只授权当前调用并留下完整审批审计', async () => {
  const seen: SandboxMode[] = []
  const registry = new ToolRegistry()
  registry.register(writeTool(seen))
  let asks = 0
  const permissions = new PermissionService({
    defaultMode: 'read-only',
    answerer: async request => { asks += 1; assert.equal(request.requestedMode, 'workspace-write'); return 'allowed-once' },
  })
  const session = await executeOne(registry, permissions, '{"sandbox_permissions":"workspace-write","justification":"需要写测试文件"}')
  assert.deepEqual(seen, ['workspace-write'])
  assert.equal(asks, 1)
  assert.equal(permissions.mode(session), 'read-only')
  assert.deepEqual(inspectApprovalAudit(session.events), { pending: [], decisions: 1 })
  assert.deepEqual(session.events.filter(event => event.type.startsWith('approval/')).map(event => event.type), [
    'approval/asked', 'approval/decided',
  ])
})

test('从不询问策略在调用审批响应器前确定性拒绝', async () => {
  const registry = new ToolRegistry()
  registry.register(writeTool([]))
  let called = false
  const permissions = new PermissionService({
    defaultApprovalPolicy: 'never', answerer: async () => { called = true; return 'allowed-once' },
  })
  const session = await executeOne(registry, permissions, '{"sandbox_permissions":"workspace-write","justification":"写入"}')
  assert.equal(called, false)
  assert.equal(session.events.find(event => event.type === 'tool/result')?.data.error?.code, 'APPROVAL_REJECTED')
  assert.equal(session.events.find(event => event.type === 'approval/decided')?.data.outcome, 'rejected')
})

test('没有审批响应器时以 APPROVAL_UNAVAILABLE 拒绝失败', async () => {
  const registry = new ToolRegistry()
  registry.register(writeTool([]))
  const session = await executeOne(registry, new PermissionService(), '{"sandbox_permissions":"workspace-write","justification":"写入"}')
  assert.equal(session.events.find(event => event.type === 'tool/result')?.data.error?.code, 'APPROVAL_UNAVAILABLE')
  assert.equal(session.events.find(event => event.type === 'approval/decided')?.data.outcome, 'unavailable')
})

test('非严格升级与参数不成对在提问前失败', async () => {
  const registry = new ToolRegistry()
  registry.register(writeTool([]))
  let asks = 0
  const permissions = new PermissionService({
    defaultMode: 'workspace-write', answerer: async () => { asks += 1; return 'allowed-once' },
  })
  const first = await executeOne(registry, permissions, '{"sandbox_permissions":"workspace-write","justification":"重复"}')
  assert.equal(first.events.find(event => event.type === 'tool/result')?.data.error?.code, 'INVALID_ESCALATION')
  const second = await executeOne(registry, permissions, '{"sandbox_permissions":"danger-full-access"}')
  assert.equal(second.events.find(event => event.type === 'tool/result')?.data.error?.code, 'INVALID_ESCALATION')
  assert.equal(asks, 0)
})

test('取消审批会丢弃迟到回答，并且只写入一个已取消决定', async () => {
  const session = new Session()
  session.append('turn/start', { turn: 1 })
  const controller = new AbortController()
  let answer!: (value: 'allowed-once') => void
  const permissions = new PermissionService({
    answerer: () => new Promise(resolve => { answer = resolve }),
  })
  const pending = permissions.authorize(
    session,
    { type: 'tool-call', id: 'c', name: 'write', arguments: '{}' },
    { sandbox_permissions: 'workspace-write', justification: '写入' },
    { minimumMode: 'workspace-write', reason: '写' },
    controller.signal,
  )
  controller.abort()
  await assert.rejects(pending, error => typeof error === 'object' && error !== null && 'code' in error && error.code === 'APPROVAL_CANCELLED')
  answer('allowed-once')
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(session.events.filter(event => event.type === 'approval/decided').map(event => event.data.outcome), ['cancelled'])
})

test('沙箱模式和审批策略由最后一个事件恢复', () => {
  const original = new Session()
  const permissions = new PermissionService()
  permissions.setMode(original, 'workspace-write')
  permissions.setMode(original, 'danger-full-access')
  permissions.setApprovalPolicy(original, 'never')
  const restored = new Session(JSON.parse(JSON.stringify(original.events)))
  assert.equal(permissions.mode(restored), 'danger-full-access')
  assert.equal(permissions.approvalPolicy(restored), 'never')
})

test.skipIf(process.platform !== 'darwin')('真实 macOS 沙箱：只读模式拒绝写入，工作区写入模式只允许写入工作区', async () => {
  const root = await mkdtemp(join(tmpdir(), 'harness-sandbox-root-'))
  const outside = await mkdtemp(join(tmpdir(), 'harness-sandbox-outside-'))
  const runtime = await LocalProcessRuntime.create()
  try {
    const shell = new LocalShell(runtime, root)
    const denied = await shell.run({ command: 'printf no > denied.txt', sandboxMode: 'read-only' })
    assert.notEqual(denied.exitCode, 0)
    await assert.rejects(readFile(join(root, 'denied.txt')), /ENOENT/)

    const allowed = await shell.run({ command: 'printf yes > allowed.txt', sandboxMode: 'workspace-write' })
    assert.equal(allowed.exitCode, 0)
    assert.equal(await readFile(join(root, 'allowed.txt'), 'utf8'), 'yes')

    const escaped = await shell.run({ command: `printf no > ${JSON.stringify(join(outside, 'escaped.txt'))}`, sandboxMode: 'workspace-write' })
    assert.notEqual(escaped.exitCode, 0)
    await assert.rejects(readFile(join(outside, 'escaped.txt')), /ENOENT/)
  } finally {
    await runtime.dispose()
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})

test('审批审计投影拒绝没有询问记录的决定', () => {
  const session = new Session()
  session.append('turn/start', { turn: 1 })
  session.append('approval/decided', { id: 'missing', outcome: 'rejected' })
  assert.throws(() => inspectApprovalAudit(session.events), /无匹配 asked/)
  assert.doesNotThrow(() => inspectLifecycle(session.events))
})
