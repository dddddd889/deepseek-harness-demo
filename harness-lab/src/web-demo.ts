import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentServer } from './agent-server.ts'
import { LocalAttachmentStore } from './attachment-store.ts'
import { HeadlessHost } from './headless-host.ts'
import { InteractionBroker } from './interactions.ts'
import { validateProfile } from './profile.ts'

const root = await mkdtemp(join(tmpdir(), 'harness-web-demo-'))
const token = 'web-demo-token-0123456789'
try {
  const profile = validateProfile({
    name: 'web-demo', provider: 'scripted', model: 'fixture', scriptedResponse: 'Web 生产闭环回答',
    persistenceRoot: join(root, 'sessions'), cwd: root, apiKeyEnv: 'X', maxSteps: 3,
    sandboxMode: 'read-only', approvalPolicy: 'ask',
  })
  const interactions = new InteractionBroker()
  const attachments = new LocalAttachmentStore(root, { maxImageBytes: 1024 * 1024, maxImagePixels: 1_000_000, mediaTypes: ['image/png'] })
  const server = new AgentServer(await HeadlessHost.open(profile, undefined, interactions), {
    authToken: token, interactions, attachments, webRoot: join(import.meta.dirname, '../web'),
  })
  const address = await server.listen()
  const page = await fetch(address.url)
  console.log('网页地址：', address.url)
  console.log('内容安全策略：', page.headers.get('content-security-policy'))
  console.log('HTML 字节数：', (await page.arrayBuffer()).byteLength)
  await server.close()
} finally { await rm(root, { recursive: true, force: true }) }
