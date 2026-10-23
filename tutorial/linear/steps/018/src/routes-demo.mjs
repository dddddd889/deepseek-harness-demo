import assert from 'node:assert/strict'
import { Agent } from './agent.mjs'
import { Settings } from './config.mjs'
import { DeepSeekModel } from './deepseek.mjs'
import { Events } from './events.mjs'
import { Routes, RefreshToken } from './routes.mjs'
import { Scope } from './scope.mjs'
import { Tools } from './tools.mjs'

/** 构造OpenAI兼容增量；固定外部响应，不替换Routes、Agent或Loop。 */
const delta = (value, finish = null) => ({ choices: [{ index: 0, delta: value, finish_reason: finish }] })
/** 用真实Response和SSE正文驱动第016步解析器；可故意省略结束信息。 */
function response(events, done = true) {
  const body = events.map(event => 'data: ' + JSON.stringify(event) + '\n\n').join('')
  return new Response(body + (done ? 'data: [DONE]\n\n' : ''), { headers: { 'content-type': 'text/event-stream' } })
}

/** 显式同步两个请求的到达时机；靠屏障控制并发，不靠sleep碰运气。 */
function gate() {
  let release
  const promise = new Promise(resolve => { release = resolve })
  return { promise, release }
}

/** 两个独立Agent共用一个RefreshToken，在构造模型鉴权头之前合并刷新。 */
async function refreshScene(scope, routes, write) {
  const owner = scope.child(), arrivals = gate(), started = gate(), finishRefresh = gate()
  // 仅为离线演示生成本地假凭据，日志和验收摘要都不输出其值。
  const expired = crypto.randomUUID(), renewed = crypto.randomUUID()
  let credential = { accessToken: expired, expiresAt: 0 }
  const stats = { getCalls: 0, refreshes: 0, writes: 0, modelHTTP: 0, requests: [] }
  const agents = [], sessions = []
  const token = new RefreshToken(
    () => credential,
    async () => {
      stats.refreshes++
      write('[凭据刷新] 开始刷新；先等待两个模型请求都进入token.get()')
      started.release()
      await finishRefresh.promise
      return { accessToken: renewed, expiresAt: Date.now() + 3_600_000 }
    },
    next => { credential = next; stats.writes++; write('[凭据保存] 新凭据已保存，不输出凭据值') },
  )
  try {
    // 只在鉴权型提供方装配这层；不修改共享DeepSeekModel实例上的key。
    owner.own(routes.add('demo-oauth', ['oauth-model'], { async *stream(request) {
      stats.getCalls++
      const pending = token.get()
      if (stats.getCalls === 2) arrivals.release()
      const accessToken = await pending
      request.signal.throwIfAborted()
      // token.get完成并保存新凭据后，模型才用本次拿到的token构造Bearer鉴权头。
      const model = new DeepSeekModel({ baseURL: 'https://oauth-model.invalid', model: 'oauth-model', key: accessToken, fetcher: async (url, options) => {
        const body = JSON.parse(options.body), headers = new Headers(options.headers)
        const label = body.messages.findLast(message => message.role === 'user').content
        const usedNewToken = headers.get('authorization') === 'Bearer ' + renewed
        const savedBeforeSend = stats.writes === 1 && credential.accessToken === renewed
        stats.modelHTTP++
        stats.requests.push({ label, usedNewToken, savedBeforeSend })
        write(`[鉴权请求 ${label}] 使用新token=${usedNewToken}，保存完成后发送=${savedBeforeSend}`)
        // 只断言布尔值，失败也不把Authorization头或token值暴露在输出里。
        assert.ok(usedNewToken, '模型请求没有使用刷新后的凭据')
        assert.ok(savedBeforeSend, '模型请求在新凭据保存前发出')
        assert.equal(body.model, 'oauth-model')
        return response([delta({ content: label + '完成' }, 'stop')])
      } })
      yield* model.stream(request)
    } }))
    for (const label of ['A', 'B']) {
      // 同一个Agent会串行执行turn；这里用两个会话的Agent，才能产生真实并发模型请求。
      const session = new Events(), tools = new Tools()
      const settings = new Settings({ provider: 'demo-oauth', model: 'oauth-model' })
      const agent = new Agent(session, routes, tools, settings)
      sessions.push(session); agents.push(agent)
      owner.own(session.on(event => {
        if (event.type === 'turn/end') write(`[并发Agent ${label}] turn/end=${event.data.reason}`)
      }))
      owner.own(() => agent.close())
      agent.submit(label)
    }
    const completed = Promise.all(agents.map(agent => agent.idle()))
    // 两个请求已经调用get且刷新已经启动，才放行刷新；HTTP此时必须仍为0。
    await Promise.race([
      Promise.all([arrivals.promise, started.promise]),
      completed.then(() => { throw Error('并发请求未进入预期的刷新等待点') }),
    ])
    stats.beforeRelease = { getCalls: stats.getCalls, refreshes: stats.refreshes, modelHTTP: stats.modelHTTP, pending: token.pending !== undefined }
    assert.deepEqual(stats.beforeRelease, { getCalls: 2, refreshes: 1, modelHTTP: 0, pending: true })
    write('[刷新等待点] 两个get已进入、刷新1次、模型HTTP仍为0；现在放行刷新')
    finishRefresh.release()
    await completed
    stats.reasons = sessions.map(session => session.read().findLast(event => event.type === 'turn/end')?.data.reason)
    stats.texts = sessions.map(session => session.read().filter(event => event.type === 'message/assistant').map(event => event.data.content).join(''))
    stats.pendingCleared = token.pending === undefined
    assert.equal(stats.refreshes, 1); assert.equal(stats.writes, 1); assert.equal(stats.modelHTTP, 2)
    assert.deepEqual(stats.reasons, ['completed', 'completed'])
    assert.deepEqual(stats.texts, ['A完成', 'B完成'])
    assert.ok(stats.pendingCleared)
  } finally {
    // 即使验收失败，也放行本地屏障，避免Agent清理永远等待演示自己挂起的刷新。
    finishRefresh.release()
    await owner.close()
  }
  stats.cleanup = { agentsClosed: agents.every(agent => agent.closed), listeners: sessions.reduce((sum, session) => sum + session.listeners.size, 0), routeRemoved: !routes.providers.has('demo-oauth') }
  assert.deepEqual(stats.cleanup, { agentsClosed: true, listeners: 0, routeRemoved: true })
  return stats
}

/** 顺序演示路由及重试，最后让两个Agent并发验证鉴权刷新；不读取真实模型Key。 */
export async function runRoutesDemo(write = console.log) {
  // 这些都是真实领域对象；唯一固定的是外部模型返回的HTTP响应。
  const scope = new Scope(), session = new Events(), tools = new Tools(), routes = new Routes()
  const settings = new Settings({ provider: 'demo-main', model: 'main-model' })
  const stats = { mainHTTP: 0, altHTTP: 0, toolRuns: 0, replayChecked: false }
  const report = { scenarios: [], stats }
  write('018路由演示：外部HTTP响应固定；Agent、Routes、SSE解析和sum工具真实执行，不发送收费请求。')

  // 每次真实调用fetcher才计数，区分一次逻辑模型请求与其内部HTTP重试。
  const main = new DeepSeekModel({ baseURL: 'https://main.invalid', key: 'demo-only', model: 'main-model', fetcher: async (url, options) => {
    const body = JSON.parse(options.body)
    stats.mainHTTP++
    write(`[主路由 HTTP #${stats.mainHTTP}] ${body.model} ${url}`)
    assert.equal(body.model, 'main-model')
    if ([1, 5, 6].includes(stats.mainHTTP)) throw Error('演示网络失败：尚未返回任何Part')
    if (stats.mainHTTP === 2) return response([
      delta({ reasoning_content: '先调用sum', tool_calls: [{ index: 0, id: 'sum-018', type: 'function', function: { name: 'sum', arguments: '{"a":2,"b":3}' } }] }, 'tool_calls'),
    ])
    if (stats.mainHTTP === 3) {
      // 下一step必须真的带上assistant调用与工具结果，不能直接打印预设成功。
      const assistant = body.messages.find(message => message.tool_calls?.some(call => call.id === 'sum-018'))
      const result = body.messages.find(message => message.role === 'tool' && message.tool_call_id === 'sum-018')
      assert.equal(assistant?.reasoning_content, '先调用sum')
      assert.deepEqual(JSON.parse(result.content), { ok: true, value: 5 })
      stats.replayChecked = true
      return response([delta({ content: '5' }, 'stop')])
    }
    if (stats.mainHTTP === 4) return response([delta({ content: '已经输出的半句' })], false)
    throw Error('出现了演示计划之外的额外HTTP调用')
  } })
  // 第二个提供方让“按配置切换路由”可见；不会作为主路由失败后的自动兜底。
  const alternate = new DeepSeekModel({ baseURL: 'https://alternate.invalid', key: 'demo-only', model: 'alt-model', fetcher: async (url, options) => {
    const body = JSON.parse(options.body)
    stats.altHTTP++
    write(`[备用路由 HTTP #${stats.altHTTP}] ${body.model} ${url}`)
    assert.equal(body.model, 'alt-model')
    return response([delta({ content: '来自备用路由的回答' }, 'stop')])
  } })

  // 路由注册和工具注册都归scope；退出时撤销，不修改旧demo入口。
  scope.own(routes.add('demo-main', ['main-model'], main))
  scope.own(routes.add('demo-alt', ['alt-model'], alternate))
  tools.register(scope, { name: 'sum', description: '计算两个数之和', schema: { type: 'object', required: ['a', 'b'], properties: { a: { type: 'number' }, b: { type: 'number' } }, additionalProperties: false }, run: args => { stats.toolRuns++; return args.a + args.b } })
  scope.own(session.on(event => {
    if (event.type === 'request/start') write(`[请求] ${event.data.config.provider}/${event.data.config.model} step=${event.data.step}`)
    if (event.type === 'stream/text') write(`[正文] ${event.data.text}`)
    if (event.type === 'tool/start') write(`[工具开始] ${event.data.call.name}`)
    if (event.type === 'message/tool') write(`[工具结果] ${JSON.stringify(event.data.content)}`)
    if (event.type === 'message/assistant' && event.data.interrupted) write('[回复状态] interrupted=true，保留半句但不记为完整完成')
    if (event.type === 'turn/error') write(`[轮次错误] ${event.data.message}`)
    if (event.type === 'turn/end') write(`[轮次结束] ${event.data.reason}`)
  }))
  // 关键接线：Agent拿到的是Routes，而不是直接拿main或alternate。
  const agent = new Agent(session, routes, tools, settings)
  scope.own(() => agent.close())

  /** 从会话事实计算验收结果，不把预期值当成实际运行结果。 */
  async function scene(name, config, prompt) {
    const before = session.records.length, mainBefore = stats.mainHTTP, altBefore = stats.altHTTP
    write(`\n=== ${name} ===`)
    settings.set(config)
    agent.submit(prompt)
    await agent.idle()
    const records = session.read(before - 1)
    const result = { name, reason: records.findLast(record => record.type === 'turn/end')?.data.reason,
      mainHTTP: stats.mainHTTP - mainBefore, altHTTP: stats.altHTTP - altBefore,
      requests: records.filter(record => record.type === 'request/start').length,
      text: records.filter(record => record.type === 'message/assistant').map(record => record.data.content).join(''),
      interrupted: records.some(record => record.type === 'message/assistant' && record.data.interrupted),
      error: records.find(record => record.type === 'turn/error')?.data.message ?? '' }
    report.scenarios.push(result)
    return result
  }

  try {
    const retried = await scene('1 首片前失败，重试成功并执行工具', { provider: 'demo-main', model: 'main-model' }, '计算2加3')
    assert.equal(retried.reason, 'completed'); assert.equal(retried.mainHTTP, 3); assert.equal(retried.requests, 2)
    assert.equal(retried.text, '5'); assert.equal(stats.toolRuns, 1); assert.equal(stats.replayChecked, true)
    const switched = await scene('2 改配置，下一turn使用备用路由', { provider: 'demo-alt', model: 'alt-model' }, '说明当前使用的路由')
    assert.equal(switched.reason, 'completed'); assert.equal(switched.mainHTTP, 0); assert.equal(switched.altHTTP, 1)
    assert.equal(switched.text, '来自备用路由的回答')
    const partial = await scene('3 首片后断流，不重试、不自动换路由', { provider: 'demo-main', model: 'main-model' }, '演示输出后断流')
    assert.equal(partial.reason, 'error'); assert.equal(partial.mainHTTP, 1); assert.equal(partial.altHTTP, 0)
    assert.equal(partial.text, '已经输出的半句'); assert.equal(partial.interrupted, true)
    const unknown = await scene('4 未注册模型直接拒绝，不发送HTTP', { provider: 'demo-main', model: 'missing-model' }, '不允许偷偷切默认模型')
    assert.equal(unknown.reason, 'error'); assert.equal(unknown.mainHTTP + unknown.altHTTP, 0)
    assert.match(unknown.error, /未知模型路由/)
    const exhausted = await scene('5 连续首片前失败，最多尝试两次', { provider: 'demo-main', model: 'main-model' }, '演示有限重试')
    assert.equal(exhausted.reason, 'error'); assert.equal(exhausted.mainHTTP, 2); assert.equal(exhausted.altHTTP, 0)
    write('\n=== 6 两个并发请求共用过期凭据，只刷新一次后再鉴权发送 ===')
    report.oauth = await refreshScene(scope, routes, write)
    report.scenarios.push({ name: '6 并发模型请求合并刷新', reason: 'completed', mainHTTP: 0, altHTTP: 0, requests: 2,
      text: report.oauth.texts.join('、'), interrupted: false, error: '', oauthHTTP: report.oauth.modelHTTP, refreshes: report.oauth.refreshes })
  } finally { await scope.close() }

  // 成功和预期错误都走完后，再核对资源清理；任何断言失败都会使CLI非零退出。
  report.cleanup = { agentClosed: agent.closed, routes: routes.providers.size, tools: tools.entries.size, listeners: session.listeners.size }
  assert.deepEqual(report.cleanup, { agentClosed: true, routes: 0, tools: 0, listeners: 0 })
  write('\n六个场景均符合预期；第3～5个场景的error是故意演示的失败，已按事实验收。')
  write('018验收结果：' + JSON.stringify(report))
  return report
}

// 可直接作为Bun入口；测试导入时不会自动运行演示或请求真实模型。
if (import.meta.main) await runRoutesDemo()
