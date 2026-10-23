import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { DeepSeekModel, toMessages } from '../src/deepseek.mjs'
import { Events } from '../src/events.mjs'
import { Tools } from '../src/tools.mjs'
import { Scope } from '../src/scope.mjs'
import { runTurn } from '../src/loop.mjs'

/** 创建单候选增量，避免把测试样本写成另一种API协议。 */
const chunk = (delta = {}, finish = null) => ({ choices: [{ index: 0, delta, finish_reason: finish }] })
/** 构造真实SSE响应；按单字节切开，覆盖中文和CRLF被网络分块的情形。 */
function response(events, done = true) {
  const bytes = new TextEncoder().encode(events.map(event => 'data: ' + JSON.stringify(event) + '\r\n\r\n').join('') + (done ? 'data: [DONE]\r\n\r\n' : ''))
  return new Response(new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close() } }))
}
/** 统一收集提供方输出，用同一个断言入口检查正常结束和异常拒绝。 */
async function collect(model, request) { const parts = []; for await (const part of model.stream(request)) parts.push(part); return parts }
/** 每次给独立signal，保持输入和取消互不干扰。 */
const request = () => ({ messages: [{ role: 'user', content: 'hi' }], tools: [], config: {}, signal: new AbortController().signal })

test('OpenAI兼容请求、交错工具分片、推理回放与usage完整保留', async () => {
  let captured
  const model = new DeepSeekModel({ key: 'test', fetcher: async (url, options) => {
    captured = { url, headers: options.headers, body: JSON.parse(options.body) }
    return response([
      chunk({ reasoning_content: '想一想', tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'read', arguments: '{"path":' } }] }),
      chunk({ tool_calls: [{ index: 1, id: 'c2', type: 'function', function: { name: 'read', arguments: '{"path":"B"}' } }] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: '"中文"}' } }] }),
      chunk({}, 'tool_calls'), { choices: [], usage: { prompt_tokens: 3, completion_tokens: 7 } },
    ])
  } })
  const input = request(); input.tools = [{ name: 'read', description: '读文件', schema: { type: 'object' } }]
  const parts = await collect(model, input)
  assert.equal(captured.url, 'https://api.deepseek.com/chat/completions')
  assert.equal(captured.headers.authorization, 'Bearer test')
  assert.equal(captured.headers['x-api-key'], undefined)
  assert.equal(captured.headers['anthropic-version'], undefined)
  assert.equal(captured.body.tools[0].type, 'function')
  assert.deepEqual(captured.body.tools[0].function.parameters, { type: 'object' })
  assert.equal(captured.body.stream_options.include_usage, true)
  assert.deepEqual(parts.filter(part => part.kind === 'tool').map(part => [part.id, part.arguments.path]), [['c1', '中文'], ['c2', 'B']])
  assert.equal(parts.find(part => part.kind === 'usage').prompt_tokens, 3)
  const replay = parts.find(part => part.kind === 'replay').value
  const history = toMessages([{ role: 'assistant', replay }, { role: 'tool', callId: 'c1', content: { ok: true, value: '内容' } }])
  assert.equal(history[0].reasoning_content, '想一想')
  assert.equal(history[0].tool_calls[0].function.arguments, '{"path":"中文"}')
  assert.equal(history[1].role, 'tool'); assert.equal(history[1].tool_call_id, 'c1')
  history[0].content = '改副本'; assert.equal(replay.message.content, '')
  assert.equal(parts.at(-1).reason, 'tools')
})

test('文字流、system、模型快照与可选v1根路径使用兼容字段', async () => {
  let captured
  const model = new DeepSeekModel({ baseURL: 'https://gateway.example/v1/', key: 'test', fetcher: async (url, options) => {
    captured = { url, body: JSON.parse(options.body) }; return response([chunk({ content: '你好' }), chunk({}, 'stop')])
  } })
  const input = request(); input.config = { model: 'custom', system: '系统说明', maxTokens: 99, thinking: { type: 'disabled' }, reasoningEffort: 'low' }
  const parts = await collect(model, input)
  assert.equal(captured.url, 'https://gateway.example/v1/chat/completions')
  assert.equal(captured.body.model, 'custom'); assert.equal(captured.body.max_tokens, 99)
  assert.deepEqual(captured.body.messages[0], { role: 'system', content: '系统说明' })
  assert.equal(captured.body.tools, undefined)
  assert.deepEqual(captured.body.thinking, { type: 'disabled' }); assert.equal(captured.body.reasoning_effort, 'low')
  assert.equal(parts.find(part => part.kind === 'text').text, '你好'); assert.equal(parts.at(-1).reason, 'stop')
})

test('缺少DONE或停止原因、截断工具JSON、错误停止原因不能伪造成功', async () => {
  const samples = [
    { events: [chunk({ content: 'partial' }, 'stop')], done: false, error: /未完整/ },
    { events: [chunk({ content: 'partial' })], done: true, error: /未完整/ },
    { events: [chunk({ tool_calls: [{ index: 0, id: 'c1', function: { name: 'read', arguments: '{' } }] }, 'tool_calls')], error: /JSON/ },
    { events: [chunk({}, 'content_filter')], error: /异常结束/ },
    { events: [{ error: { message: 'provider error' } }], error: /provider error/ },
    { events: [chunk({}, 'tool_calls')], error: /不匹配/ },
  ]
  for (const sample of samples) {
    const model = new DeepSeekModel({ key: 'test', fetcher: async () => response(sample.events, sample.done ?? true) })
    await assert.rejects(() => collect(model, request()), sample.error)
  }
})

test('HTTP失败、取消与length保留各自结果', async () => {
  const denied = new DeepSeekModel({ key: 'test', fetcher: async () => new Response('', { status: 401 }) })
  await assert.rejects(() => collect(denied, request()), /401/)
  const controller = new AbortController(), input = request(); input.signal = controller.signal; controller.abort(Error('用户取消'))
  const cancelled = new DeepSeekModel({ key: 'test', fetcher: async () => { throw Error('不应请求网络') } })
  await assert.rejects(() => collect(cancelled, input), /用户取消/)
  const limited = new DeepSeekModel({ key: 'test', fetcher: async () => response([chunk({ content: '未完' }, 'length')]) })
  assert.equal((await collect(limited, request())).at(-1).reason, 'length')
})

test('执行循环贯通两次兼容请求：工具真实执行，结果与推理进入下一次历史', async () => {
  const session = new Events(), tools = new Tools(), scope = new Scope(), requests = []
  let runs = 0
  tools.register(scope, { name: 'sum', schema: { type: 'object' }, run: args => { runs++; return args.a + args.b } })
  const model = new DeepSeekModel({ key: 'test', fetcher: async (url, options) => {
    requests.push(JSON.parse(options.body))
    return requests.length === 1
      ? response([chunk({ reasoning_content: '先求和', tool_calls: [{ index: 0, id: 'sum-1', type: 'function', function: { name: 'sum', arguments: '{"a":2,"b":3}' } }] }, 'tool_calls')])
      : response([chunk({ content: '5' }, 'stop')])
  } })
  try {
    const result = await runTurn({ session, tools, model, signal: new AbortController().signal }, '计算2加3')
    assert.equal(result.reason, 'completed'); assert.equal(runs, 1); assert.equal(requests.length, 2)
    assert.equal(requests[1].messages[1].reasoning_content, '先求和')
    assert.equal(requests[1].messages[2].tool_call_id, 'sum-1')
    assert.deepEqual(JSON.parse(requests[1].messages[2].content), { ok: true, value: 5 })
    assert.equal(session.read().filter(event => event.type === 'message/assistant').at(-1).data.content, '5')
  } finally { await scope.close() }
})