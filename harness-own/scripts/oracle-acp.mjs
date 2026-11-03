import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Readable, Writable } from 'node:stream'
import * as acp from '@agentclientprotocol/sdk'
import { writeSync } from 'node:fs'

// 这个文件只属于对照进程：导入原版测试装配，绝不能进入自己的产品构建。
if (!process.env.HARNESS_ORACLE_SOURCE) throw Error('需要显式指定锁定原版目录')
const source = resolve(process.env.HARNESS_ORACLE_SOURCE)
const { makeBridgeHarness, textResponse } = await import(pathToFileURL(resolve(source, 'packages/acp/acp/tests/harness.ts')).href)
const original = await makeBridgeHarness({ script: [textResponse('golden-answer'), 'hang', textResponse('after-cancel')] })
const modelStream = original.adapter.stream.bind(original.adapter)
original.adapter.stream = async function* (request) {
  for await (const chunk of modelStream(request)) { yield chunk; if (chunk.type === 'text-delta' && chunk.text === 'partial') writeSync(3, 'partial-consumed\n') }
}
const peers = new Map()
let delivery = Promise.resolve()
const push = original.sessionUpdates.push.bind(original.sessionUpdates)
original.sessionUpdates.push = (...items) => {
  const length = push(...items)
  for (const item of items) delivery = delivery.then(() => peers.get(item.sessionId)?.notify(acp.methods.client.session.update, item))
  return length
}
original.onPermission = params => peers.get(params.sessionId).request(acp.methods.client.session.requestPermission, params)
const app = acp.agent({ name: 'fixed-upstream-oracle' })
app.onRequest('initialize', ctx => original.client.initialize(ctx.params))
app.onRequest('authenticate', ctx => original.client.authenticate(ctx.params))
app.onRequest('session/new', async ctx => { const result = await original.client.newSession(ctx.params); peers.set(result.sessionId, ctx.client); return result })
app.onRequest('session/prompt', async ctx => { const result = await original.client.prompt(ctx.params); await delivery; return result })
app.onNotification('session/cancel', ctx => original.client.cancel(ctx.params))
app.onRequest('session/list', ctx => original.client.listSessions(ctx.params))
app.onRequest('session/close', ctx => original.client.closeSession(ctx.params))
app.onRequest('session/resume', ctx => original.client.resumeSession(ctx.params))
const connection = app.connect(acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)))
try { await connection.closed } finally { await original.dispose() }
