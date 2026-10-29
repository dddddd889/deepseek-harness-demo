import assert from 'node:assert/strict'
import { Agent } from './agent.mjs'
import { Settings } from './config.mjs'
import { Events } from './events.mjs'
import { PiModel } from './pi.mjs'
import { Routes } from './routes.mjs'
import { Scope } from './scope.mjs'
import { Tools } from './tools.mjs'

/** 创建DeepSeek兼容的SSE响应，SDK负责解析及工具参数拼接。 */
function fixtureResponse(events) {
  return new Response(events.map(event => 'data: ' + JSON.stringify(event) + '\n\n').join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
}
/** 固定HTTP样本中的单候选增量，停止原因仍走真实SDK解析。 */
const chunk = (delta, finish = null) => ({ choices: [{ index: 0, delta, finish_reason: finish }] })

/** 实际装配Routes和PiModel；默认固定外部响应，--live才访问DeepSeek。 */
export async function runPiDemo({ live = false, key, baseURL = 'https://api.deepseek.com', modelId = 'deepseek-flash', write = console.log } = {}) {
  if (live && !key) throw Error('真实请求缺少DEEPSEEK_API_KEY，请先配置本机.env；不会回退到离线样本')
  // 所有输出统一遮盖本次凭据；不打印请求头、模型实例或整个环境变量。
  const log = message => write(live && key ? String(message).replaceAll(key, '[已隐藏]') : message)
  const scope = new Scope(), session = new Events(), tools = new Tools(), routes = new Routes()
  const stats = { http: [], toolRuns: 0, historyChecked: false, reasoningReplayed: false }
  // 远端仍是DeepSeek，只有访问实现换成PiModel与pi-ai；不是OpenAI模型。
  const model = { id: modelId, name: modelId, api: 'openai-completions', provider: 'deepseek', baseUrl: baseURL.replace(/\/+$/, ''),
    reasoning: true, input: ['text'], contextWindow: 32768, maxTokens: 4096,
    // 本课不维护价格目录，零系数只是SDK必填占位，不能用来推断真实请求免费。
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    compat: { supportsStore: false, supportsDeveloperRole: false, supportsStrictMode: false, supportsReasoningEffort: true,
      maxTokensField: 'max_tokens', requiresReasoningContentOnAssistantMessages: true, thinkingFormat: 'deepseek' } }
  const settings = new Settings({ provider: 'deepseek-pi', model: modelId, reasoning: 'low', maxTokens: 4096,
    system: '你正在验收工具调用。必须先调用sum工具计算用户给出的两个数，收到工具结果后只输出结果数字。' })
  log(`[运行方式] ${live ? '真实DeepSeek请求，会使用模型额度' : '离线：DeepSeek协议响应固定，不发送网络请求'}`)
  log(`[调用链] Agent → Routes(deepseek-pi) → PiModel → pi-ai → DeepSeek(${modelId})`)

  // SDK真正生成请求；这里只观察正文中的调用关联，隐藏鉴权，最多放行两次HTTP。
  const fetcher = async (input, init) => {
    const request = new Request(input, init)
    const body = await request.clone().json()
    if (stats.http.length >= 2) throw Error('020演示最多发送两次HTTP；模型未按预期完成工具续轮')
    assert.equal(body.model, modelId)
    assert.ok(new URL(request.url).pathname.endsWith('/chat/completions'))
    assert.equal(body.tools[0].function.name, 'sum')
    assert.equal(body.thinking.type, 'enabled')
    const index = stats.http.length
    if (index === 1) {
      // 工具结果必须来自真正执行，且和上一条assistant调用使用同一个身份。
      const assistant = body.messages.findLast(message => message.role === 'assistant' && message.tool_calls?.length)
      const result = body.messages.findLast(message => message.role === 'tool')
      assert.ok(assistant && result, '第二次请求缺少assistant调用或tool结果')
      assert.equal(result.tool_call_id, assistant.tool_calls[0].id)
      assert.deepEqual(JSON.parse(result.content), { ok: true, value: 5 })
      assert.equal(typeof assistant.reasoning_content, 'string')
      if (!live) assert.equal(assistant.reasoning_content, '先调用sum计算')
      stats.historyChecked = true
      stats.reasoningReplayed = true
    }
    stats.http.push({ model: body.model, toolResultIncluded: index === 1 })
    log(`[HTTP #${index + 1}] ${modelId} /chat/completions，携带工具结果=${index === 1}`)
    if (live) return await fetch(request)
    // 只替换外部HTTP：真实SDK仍需拼接工具JSON，真实Loop仍需实际执行sum。
    if (index === 0) return fixtureResponse([
      chunk({ role: 'assistant', reasoning_content: '先调用sum计算' }),
      chunk({ tool_calls: [{ index: 0, id: 'sum-020', type: 'function', function: { name: 'sum', arguments: '{"a":2,' } }] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: '"b":3}' } }] }),
      chunk({}, 'tool_calls'), { choices: [], usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 } },
    ])
    return fixtureResponse([chunk({ role: 'assistant', content: '5' }, 'stop'), { choices: [], usage: { prompt_tokens: 20, completion_tokens: 1, total_tokens: 21 } }])
  }
  const adapter = new PiModel(model, live ? key : 'offline-only', fetcher)
  scope.own(routes.add('deepseek-pi', [modelId], adapter))
  tools.register(scope, { name: 'sum', description: '计算两个数之和，必须调用本工具获得结果', schema: { type: 'object', required: ['a', 'b'], properties: { a: { type: 'number' }, b: { type: 'number' } }, additionalProperties: false }, run: args => {
    stats.toolRuns++
    assert.deepEqual(args, { a: 2, b: 3 })
    return args.a + args.b
  } })
  scope.own(session.on(event => {
    if (event.type === 'request/start') log(`[请求] ${event.data.config.provider}/${event.data.config.model} step=${event.data.step}`)
    if (event.type === 'tool/start') log(`[工具开始] ${event.data.call.name}`)
    if (event.type === 'message/tool') log(`[工具结果] ${JSON.stringify(event.data.content)}`)
    if (event.type === 'stream/text') log(`[正文] ${event.data.text}`)
    if (event.type === 'turn/error') log(`[轮次错误] ${event.data.message}`)
    if (event.type === 'turn/end') log(`[轮次结束] ${event.data.reason}`)
  }))
  const agent = new Agent(session, routes, tools, settings)
  scope.own(() => agent.close())
  let report
  try {
    agent.submit('请务必先调用sum工具计算2加3，取得工具结果后只输出结果数字。')
    await agent.idle()
    const records = session.read(), messages = records.filter(event => event.type === 'message/assistant')
    report = { mode: live ? 'live' : 'offline', route: 'deepseek-pi', provider: model.provider, model: modelId, api: model.api,
      reason: records.findLast(event => event.type === 'turn/end')?.data.reason,
      requests: records.filter(event => event.type === 'request/start').length,
      http: stats.http.length, toolRuns: stats.toolRuns, historyChecked: stats.historyChecked, reasoningReplayed: stats.reasoningReplayed,
      usageEvents: records.filter(event => event.type === 'request/usage').length,
      replayProviders: messages.map(event => event.data.replay?.provider), finalText: messages.at(-1)?.data.content.trim() ?? '' }
    assert.equal(report.reason, 'completed')
    assert.equal(report.requests, 2); assert.equal(report.http, 2); assert.equal(report.toolRuns, 1)
    assert.ok(report.historyChecked && report.reasoningReplayed)
    assert.deepEqual(report.replayProviders, ['pi', 'pi'])
    assert.equal(report.finalText, '5')
  } finally { await scope.close() }
  report.cleanup = { agentClosed: agent.closed, routes: routes.providers.size, tools: tools.entries.size, listeners: session.listeners.size }
  assert.deepEqual(report.cleanup, { agentClosed: true, routes: 0, tools: 0, listeners: 0 })
  log('020验收结果：' + JSON.stringify(report))
  return report
}

// 命令行默认离线；真实请求必须显式指定--live并提供Key，失败非零退出。
if (import.meta.main) {
  const live = process.argv.slice(2).includes('--live')
  const key = live ? process.env.DEEPSEEK_API_KEY : undefined
  try {
    if (process.argv.slice(2).some(arg => arg !== '--live')) throw Error('只支持无参数或--live；演示任务固定为调用sum计算2加3')
    await runPiDemo({ live, key, baseURL: live ? process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com' : 'https://api.deepseek.com',
      modelId: live ? process.env.DSH_MODEL ?? 'deepseek-flash' : 'deepseek-flash' })
  } catch (error) {
    const message = live && key ? String(error.message).replaceAll(key, '[已隐藏]') : error.message
    console.error('020演示失败：' + message)
    process.exitCode = 1
  }
}