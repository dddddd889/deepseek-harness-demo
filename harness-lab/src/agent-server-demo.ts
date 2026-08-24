import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentServer } from './agent-server.ts'
import { HeadlessHost } from './headless-host.ts'
import { validateProfile } from './profile.ts'

const root = await mkdtemp(join(tmpdir(), 'harness-agent-server-demo-'))
const token = 'demo-token-0123456789abcdef'
try {
  const profile = validateProfile({
    name: 'server-demo', provider: 'scripted', model: 'fixture', scriptedResponse: 'Agent Server 回答',
    persistenceRoot: join(root, 'sessions'), cwd: root, apiKeyEnv: 'DEEPSEEK_API_KEY',
    maxSteps: 3, sandboxMode: 'read-only', approvalPolicy: 'never',
  })
  const server = new AgentServer(await HeadlessHost.open(profile), { authToken: token })
  const address = await server.listen()
  console.log('listening:', address)

  const rpc = async (id: string, method: string, params: Record<string, unknown>) => {
    const response = await fetch(`${address.url}/rpc`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    })
    return response.json()
  }
  console.log('create:', await rpc('1', 'session.create', { sessionId: 'demo' }))
  console.log('send:', await rpc('2', 'session.send', { sessionId: 'demo', text: '解释架构' }))
  const snapshot = await rpc('3', 'session.snapshot', { sessionId: 'demo' }) as { result?: { events?: unknown[] } }
  console.log('snapshot event count:', snapshot.result?.events?.length)
  await server.close()
} finally {
  await rm(root, { recursive: true, force: true })
}
