import { appendFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMessage } from './domain.ts'
import { JsonlSessionStore } from './session-store.ts'

const root = await mkdtemp(join(tmpdir(), 'harness-persistence-demo-'))
try {
  const first = await JsonlSessionStore.open(root)
  const created = await first.create('demo', '/workspace')
  created.session.append('turn/start', { turn: 1 }, 100)
  created.session.append('step/start', { turn: 1, step: 1 }, 101)
  created.session.append('assistant/message', {
    turn: 1, step: 1,
    message: createMessage({
      role: 'assistant', source: { kind: 'model', provider: 'fake', model: 'debug' },
      content: [{ type: 'tool-call', id: 'write-1', name: 'fs_write', arguments: '{}' }],
    }),
  }, 102)
  created.session.append('tool/call', {
    turn: 1, step: 1, callId: 'write-1', name: 'fs_write', arguments: '{}',
  }, 103)
  await first.flush(created.session)
  await first.close(created.session)
  await appendFile(first.pathFor('demo'), '{"torn":')

  const second = await JsonlSessionStore.open(root)
  const resumed = await second.resume('demo')
  console.log('修复结果：', resumed.repair)
  console.table(resumed.session.events.map(event => ({ seq: event.seq, type: event.type })))
  const branch = await second.fork('demo', 'demo-branch', 2)
  console.log('分叉会话的父级：', branch.header.parent)
  await second.dispose()
} finally {
  await rm(root, { recursive: true, force: true })
}
