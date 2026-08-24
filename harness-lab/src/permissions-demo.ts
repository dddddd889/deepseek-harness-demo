import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PermissionService } from './permissions.ts'
import { Session } from './session.ts'
import { executeToolCalls } from './tool-execution.ts'
import { ToolRegistry } from './tools.ts'
import { createWorkspaceFsTools, WorkspaceFs } from './workspace-fs.ts'

const root = await mkdtemp(join(tmpdir(), 'harness-permission-demo-'))
try {
  const registry = new ToolRegistry()
  const fs = await WorkspaceFs.open(root)
  for (const tool of createWorkspaceFsTools(fs)) registry.register(tool)
  const permissions = new PermissionService({
    defaultMode: 'read-only',
    answerer: async request => {
      console.log('审批问题：', request.reason)
      return 'allowed-once'
    },
  })
  const session = new Session()
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })

  await executeToolCalls(registry, session, 1, 1, [{
    type: 'tool-call', id: 'denied', name: 'fs_write',
    arguments: '{"path":"denied.txt","content":"no"}',
  }], new AbortController().signal, permissions)

  await executeToolCalls(registry, session, 1, 1, [{
    type: 'tool-call', id: 'approved', name: 'fs_write',
    arguments: '{"path":"approved.txt","content":"yes","sandbox_permissions":"workspace-write","justification":"演示一次性写权限"}',
  }], new AbortController().signal, permissions)
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

  console.log('长期模式仍为：', permissions.mode(session))
  console.log('批准后文件：', await fs.readText('approved.txt'))
  console.table(session.events.map(event => ({ seq: event.seq, type: event.type })))
} finally {
  await rm(root, { recursive: true, force: true })
}
