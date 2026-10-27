import assert from 'node:assert/strict'
import { Agent } from './agent.mjs'
import { Settings } from './config.mjs'
import { DeepSeekModel } from './deepseek.mjs'
import { Events } from './events.mjs'
import { answer, call } from './model.mjs'
import { Scope } from './scope.mjs'
import { Subagents } from './subagents.mjs'
import { subagentTools } from './subagent-tools.mjs'
import { Tools } from './tools.mjs'

/** 固定外部模型响应，但根据真正收到的工具结果决定下一次调用。 */
function fixedModel(next) {
  return {
    requests: [],
    async *stream(request) {
      this.requests.push(request)
      for (const part of next(request)) { request.signal.throwIfAborted(); yield part }
    },
  }
}

/** 工具结果由Loop包装成{ok,value}，失败时不能继续伪装成功。 */
function toolValue(message) {
  assert.equal(message?.role, 'tool', '下一步必须先收到工具结果')
  assert.equal(message.content.ok, true, '工具失败：' + message.content.error)
  return message.content.value
}

/** 从wait得到的孩子会话中提取最后一条已提交的assistant正文。 */
function lastAnswer(events) {
  return events.findLast(event => event.type === 'message/assistant' && !event.data.calls?.length)?.data.content ?? ''
}

/** 真实父/子Agent共用已有Loop；默认离线，显式--live才请求DeepSeek。 */
export async function runSubagentsDemo({ unitPrice = 19, quantity = 3, live = false, key,
  baseURL = 'https://api.deepseek.com', modelId = 'deepseek-flash', write = console.log } = {}) {
  if (live && !key) throw Error('真实请求缺少DEEPSEEK_API_KEY；请先配置本机.env，不会回退到离线样本')
  assert.ok(Number.isFinite(unitPrice) && unitPrice >= 0 && Number.isSafeInteger(quantity) && quantity > 0, '订单参数不合法')
  // 只打印业务进度；保护本次Key，不打印模型实例或请求鉴权头。
  const log = text => write(live && key ? String(text).replaceAll(key, '[已隐藏]') : text)
  const scope = new Scope(), parentSession = new Events(), parentTools = new Tools()
  const stats = { parentRequests: 0, childRequests: 0, factoryCalls: 0, childToolRuns: 0, guardCalls: [] }
  const childRecords = [] // 保存真实孩子对象以便验收和正常退出后核对资源。
  const initialTask = '你是订单计算助手。此条只是初始化，请回答“已准备好”，等待下一条订单JSON再计算。'
  const order = { unitPrice, quantity } // 固定外部模型样本会把这份数据作为工具参数提交。
  const parentPrompt = `请严格依次完成：1.调用subagent_create，task为${JSON.stringify(initialTask)}；2.取返回的id调用subagent_send，text为${JSON.stringify(JSON.stringify(order))}；3.用同一id调用subagent_wait；4.读取返回事件中孩子最后一条assistant的JSON，按其中total回答“子Agent已计算：订单总价为TOTAL元。”，把TOTAL换成真实结果，不要自己计算或提前回答。`

  // 父模型只看自己的历史；孩子编号必须来自create的真实工具结果。
  const parentSample = fixedModel(request => {
    assert.deepEqual(request.tools.map(tool => tool.name), ['subagent_create', 'subagent_send', 'subagent_wait', 'subagent_interrupt'])
    assert.ok(request.tools.every(tool => !('run' in tool)), '模型不应得到宿主执行函数')
    const last = request.messages.at(-1)
    if (last?.role === 'user') return call('subagent_create', { task: initialTask }, 'parent-create')
    const value = toolValue(last) // 每次先读上一次真实结果，而非预填childId。
    if (last.name === 'subagent_create') return call('subagent_send', { id: value.id, text: JSON.stringify(order) }, 'parent-send')
    const creation = request.messages.find(message => message.role === 'tool' && message.name === 'subagent_create')
    const childId = toolValue(creation).id // send只返回receipt，要从先前create结果取孩子编号。
    if (last.name === 'subagent_send') return call('subagent_wait', { id: childId }, 'parent-wait')
    assert.equal(last.name, 'subagent_wait')
    const result = JSON.parse(lastAnswer(value)) // 这里只读wait返回的事件，不直接访问孩子或stats。
    return answer(`子Agent已计算：订单总价为${result.total}元。`)
  })

  /** 观察每个Agent实际进入的模型请求；live也不改变Agent和工具接线。 */
  function modelFor(role, sample) {
    const provider = live ? new DeepSeekModel({ key, baseURL, model: modelId }) : sample
    return {
      async *stream(request) {
        const counter = role === '父' ? 'parentRequests' : 'childRequests'
        stats[counter]++
        if (stats[counter] > 8) throw Error(role + 'Agent超过本演示8次模型请求预算')
        log(`[${role}模型请求 #${stats[counter]}] 工具=${request.tools.map(tool => tool.name).join(',')}`)
        yield* provider.stream(request)
      },
    }
  }

  /** 订阅的是应用日志，不是把孩子输出主动注入父模型。 */
  function observe(role, session, ownerScope) {
    ownerScope.own(session.on(event => {
      if (event.type === 'tool/start') log(`[${role}工具] ${event.data.call.name} ${JSON.stringify(event.data.call.arguments)}`)
      if (event.type === 'message/tool' && event.data.name !== 'subagent_wait') log(`[${role}工具结果] ${event.data.name} ${JSON.stringify(event.data.content)}`)
      if (event.type === 'message/tool' && event.data.name === 'subagent_wait') log(`[父工具结果] subagent_wait 返回${event.data.content.value?.length ?? 0}条子会话事件`)
      if (event.type === 'message/assistant' && event.data.content) log(`[${role}回答] ${event.data.content}`)
      if (event.type === 'turn/error') log(`[${role}轮次错误] ${event.data.message}`)
    }))
  }

  const children = new Subagents(async () => {
    stats.factoryCalls++
    const childScope = scope.child(), session = new Events(), tools = new Tools() // 独立孩子会话/工具表，不复用父工具表。
    const sample = fixedModel(request => {
      const last = request.messages.at(-1)
      if (last?.role === 'tool') return answer(JSON.stringify(toolValue(last))) // 最终JSON必须来自真实order_total。
      if (last?.content === initialTask) return answer('已准备好')
      return call('order_total', JSON.parse(last.content), 'child-total')
    })
    tools.register(childScope, {
      name: 'order_total', description: '计算订单总价，返回unitPrice、quantity和total；必须实际调用后回答JSON。', effect: 'read', exclusive: false,
      schema: { type: 'object', properties: { unitPrice: { type: 'number' }, quantity: { type: 'number' } }, required: ['unitPrice', 'quantity'], additionalProperties: false },
      run(args) {
        stats.childToolRuns++
        return { ...args, total: args.unitPrice * args.quantity } // 真正的计算发生在子Agent工具内部。
      },
    })
    const settings = new Settings({ model: modelId, maxTokens: 1024, thinking: { type: 'disabled' },
      system: '你是订单计算助手。初始化消息只回答已准备好。收到订单JSON后必须先调用order_total，再把工具返回value对象原样输出为JSON，禁止代码围栏和解释。' })
    const agent = new Agent(session, modelFor('子', sample), tools, settings)
    childRecords.push({ scope: childScope, session, tools, agent, pid: process.pid })
    observe('子', session, childScope)
    log(`[创建孩子] parent=${parentSession.id} childSession=${session.id} pid=${process.pid}`)
    return agent // 管理器会把agent.close登记到父scope，关闭后撤销childId。
  })
  subagentTools(scope, parentTools, children, parentSession.id)
  // 本例没有安装生产权限策略；这里记录统一守卫确实经过，真实项目仍需接审批/限制。
  parentTools.guard = async tool => { stats.guardCalls.push(tool.name) }
  observe('父', parentSession, scope)
  const parentSettings = new Settings({ model: modelId, maxTokens: 2048, thinking: { type: 'disabled' },
    system: '严格依次执行用户要求的subagent_create、subagent_send、subagent_wait，每次等上一个工具结果后再调用下一个。拿到wait结果后才回答。' })
  const parent = new Agent(parentSession, modelFor('父', parentSample), parentTools, parentSettings)
  scope.own(() => parent.close())
  log(`[运行方式] ${live ? '真实DeepSeek：父子均使用同一显式提供方，消耗模型额度' : '离线固定模型响应：父子Agent、Loop、工具与结果回填均真实执行，不联网'}`)
  let report // 先保存运行证据，finally清理后再补充资源状态。
  try {
    parent.submit(parentPrompt) // 应用只提交父任务；不直接调用children.create/send/wait。
    await parent.idle()
    const events = parentSession.read(), toolEvents = events.filter(event => event.type === 'message/tool')
    const sequence = toolEvents.map(event => event.data.name), waitEvent = toolEvents.find(event => event.data.name === 'subagent_wait')
    const childEvents = toolValue(waitEvent?.data), childFinal = JSON.parse(lastAnswer(childEvents))
    const finalText = lastAnswer(events), expectedTotal = unitPrice * quantity
    assert.deepEqual(sequence, ['subagent_create', 'subagent_send', 'subagent_wait'])
    assert.deepEqual(stats.guardCalls, sequence) // 每次委派都经过父Tools的统一守卫。
    assert.ok(toolEvents.every(event => event.data.content.ok), '父工具调用必须都成功')
    assert.equal(childFinal.total, expectedTotal)
    assert.equal(finalText.trim(), `子Agent已计算：订单总价为${expectedTotal}元。`)
    assert.equal(stats.factoryCalls, 1); assert.equal(stats.childToolRuns, 1)
    assert.equal(events.findLast(event => event.type === 'turn/end')?.data.reason, 'completed')
    assert.deepEqual(childEvents.filter(event => event.type === 'turn/end').map(event => event.data.reason), ['completed', 'completed'])
    const childId = toolValue(toolEvents[0].data).id
    // 父最后一次模型请求必须真正携带wait工具结果，不能只在应用日志里看过孩子答案。
    const finalRequest = events.findLast(event => event.type === 'request/start').data
    const replayedWait = finalRequest.messages.findLast(message => message.role === 'tool' && message.name === 'subagent_wait')
    assert.deepEqual(toolValue(replayedWait), childEvents)
    assert.ok(childId.startsWith('child_')); assert.notEqual(childId, childRecords[0].session.id)
    report = { mode: live ? 'live' : 'offline', parentSessionId: parentSession.id, childId, childSessionId: childRecords[0].session.id,
      pid: process.pid, sameProcess: childRecords.every(record => record.pid === process.pid), parentRequests: stats.parentRequests, childRequests: stats.childRequests,
      parentToolSequence: sequence, parentGuardCalls: stats.guardCalls, factoryCalls: stats.factoryCalls, childToolRuns: stats.childToolRuns,
      childTurns: childEvents.filter(event => event.type === 'turn/end').length, waitedEvents: childEvents.length, childResult: childFinal,
      parentReadWaitResult: replayedWait.content.ok, finalText, reason: 'completed' }
    if (!live) { assert.equal(report.parentRequests, 4); assert.equal(report.childRequests, 3) }
  } finally { await scope.close() }
  report.cleanup = { parentClosed: parent.closed, children: children.entries.size, parentTools: parentTools.entries.size,
    parentListeners: parentSession.listeners.size, childClosed: childRecords.every(record => record.agent.closed),
    childTools: childRecords.reduce((sum, record) => sum + record.tools.entries.size, 0),
    childListeners: childRecords.reduce((sum, record) => sum + record.session.listeners.size, 0) }
  assert.deepEqual(report.cleanup, { parentClosed: true, children: 0, parentTools: 0, parentListeners: 0, childClosed: true, childTools: 0, childListeners: 0 })
  log('036验收结果：' + JSON.stringify(report))
  return report
}

// 默认不读Key、不发网络；只有显式--live才采用本机DeepSeek配置。
if (import.meta.main) {
  const live = process.argv.slice(2).includes('--live'), key = live ? process.env.DEEPSEEK_API_KEY : undefined
  try {
    if (process.argv.slice(2).some(arg => arg !== '--live')) throw Error('只支持无参数或--live；订单固定为19元×3件')
    await runSubagentsDemo({ live, key, baseURL: live ? process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com' : 'https://api.deepseek.com',
      modelId: live ? process.env.DSH_MODEL ?? 'deepseek-flash' : 'deepseek-flash' })
  } catch (error) {
    console.error('036演示失败：' + (live && key ? String(error.message).replaceAll(key, '[已隐藏]') : error.message))
    process.exitCode = 1
  }
}
