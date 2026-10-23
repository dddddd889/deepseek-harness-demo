import * as acp from '@agentclientprotocol/sdk'
import { mountMCP } from './mcp.mjs'

/** ACP只做协议粘合，执行/持久化/权限仍用同一个Host。 */
export function acpApp(host, owner = 'acp') {
  const app = acp.agent({ name: 'harness-own' })
  const owned = new Set(), pending = new Set()
  const options = record => [{ id: 'model', category: 'model', name: '模型', type: 'select', currentValue: record.settings.snapshot().model ?? 'offline', options: [{ value: 'offline', name: '离线演示' }, { value: 'deepseek-flash', name: 'DeepSeek Flash' }] }]
  app.onRequest('initialize', () => ({ protocolVersion: acp.PROTOCOL_VERSION, agentInfo: { name: 'harness-own', version: '0.1.0' }, agentCapabilities: { mcpCapabilities: { http: true }, promptCapabilities: { image: false, audio: false, embeddedContext: false }, sessionCapabilities: { list: {}, resume: {}, close: {} } }, authMethods: [] }))
  app.onRequest('authenticate', () => ({}))
  app.onRequest('session/new', async ctx => {
    const record = host.create({ cwd: ctx.params.cwd, owner })
    try {
      for (const [index, server] of ctx.params.mcpServers.entries()) await mountMCP(record.scope, record.tools, 'acp' + index, server.type === 'http' ? { url: server.url, headers: Object.fromEntries((server.headers ?? []).map(item => [item.name, item.value])) } : { command: server.command, args: server.args, env: Object.fromEntries((server.env ?? []).map(item => [item.name, item.value])) })
      owned.add(record.header.id)
      return { sessionId: record.header.id, configOptions: options(record) }
    } catch (error) { await host.closeSession(record.header.id, owner); throw error }
  })
  app.onRequest('session/list', () => ({ sessions: host.list(owner).map(header => ({ sessionId: header.id, cwd: header.cwd, title: header.title, updatedAt: new Date(header.createdAt).toISOString() })) }))
  app.onRequest('session/resume', ctx => {
    const record = host.open(ctx.params.sessionId, owner)
    if (record.header.cwd !== ctx.params.cwd) throw acp.RequestError.invalidParams(undefined, '工作区不一致')
    owned.add(record.header.id); return { configOptions: options(record) }
  })
  app.onRequest('session/close', async ctx => { await host.closeSession(ctx.params.sessionId, owner); owned.delete(ctx.params.sessionId); return {} })
  app.onRequest('session/set_config_option', ctx => {
    const record = host.open(ctx.params.sessionId, owner)
    if (ctx.params.configId !== 'model' || !['offline', 'deepseek-flash'].includes(ctx.params.value)) throw acp.RequestError.invalidParams(undefined, '未知模型配置')
    record.settings.set({ model: ctx.params.value }); return { configOptions: options(record) }
  })
  app.onNotification('session/cancel', async ctx => { if (!owned.has(ctx.params.sessionId)) return; const record = host.open(ctx.params.sessionId, owner); record.agent.cancel(); await record.agent.idle() })
  app.onRequest('session/prompt', async ctx => {
    const sessionId = ctx.params.sessionId, record = host.open(sessionId, owner)
    if (pending.has(sessionId)) throw acp.RequestError.invalidParams(undefined, '会话已有prompt')
    if (ctx.params.prompt.some(part => part.type !== 'text')) throw acp.RequestError.invalidParams(undefined, '当前路由仅支持文本')
    pending.add(sessionId)
    let delivery = Promise.resolve(), deliveryError
    const unsubscribe = record.session.on(event => {
      let update
      if (event.type === 'message/assistant') update = { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: event.data.content }, messageId: 'message-' + event.seq }
      if (event.type === 'tool/start') update = { sessionUpdate: 'tool_call', toolCallId: event.data.call.id, title: event.data.call.name, kind: 'other', status: 'in_progress', rawInput: event.data.call.arguments }
      if (event.type === 'message/tool') update = { sessionUpdate: 'tool_call_update', toolCallId: event.data.callId, status: event.data.content.ok ? 'completed' : 'failed', rawOutput: event.data.content }
      if (update) delivery = delivery.then(() => ctx.client.notify(acp.methods.client.session.update, { sessionId, update })).catch(error => { deliveryError = error; record.agent.cancel() })
      if (event.type === 'approval/request') void ctx.client.request(acp.methods.client.session.requestPermission, { sessionId,
        toolCall: { toolCallId: event.data.question.call.id, title: event.data.question.call.name, status: 'pending', kind: 'other' },
        options: [{ optionId: 'allow', kind: 'allow_once', name: '允许一次' }, { optionId: 'deny', kind: 'reject_once', name: '拒绝' }],
      }).then(answer => { record.approvals.answer(sessionId, event.data.id, answer.outcome.outcome === 'selected' && answer.outcome.optionId === 'allow') }).catch(() => { try { record.approvals.answer(sessionId, event.data.id, false) } catch {} })
    })
    try {
      record.agent.submit(ctx.params.prompt.map(part => part.text).join('\n'))
      await record.agent.idle(); await delivery
      if (deliveryError) throw deliveryError
      const reason = record.session.read().filter(event => event.type === 'turn/end').at(-1)?.data.reason
      if (reason === 'error') throw acp.RequestError.internalError(undefined, 'Agent失败')
      return { stopReason: reason === 'cancelled' ? 'cancelled' : reason === 'length' ? 'max_tokens' : 'end_turn' }
    } finally { unsubscribe(); pending.delete(sessionId) }
  })
  return app
}
