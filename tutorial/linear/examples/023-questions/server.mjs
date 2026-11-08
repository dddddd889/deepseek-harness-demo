import { Questions } from './questions.mjs'
import { createQuestionAgent } from './ask-user-tool.mjs'

/** 独立教学服务器，接真实Agent/Tools/Loop和固定模型，不接Host或外部模型。 */
export function startDemo(port = 0) {
  const state = { question: null, result: null, running: false }, owner = 'demo-session'
  const questions = new Questions(event => {
    if (event.type === 'question/request') state.question = { id: event.id, ...event.question }
    if (event.type === 'question/settled') state.question = null
  })
  const runtime = createQuestionAgent(questions, owner)
  /** 提交给真实Agent：固定模型先调用ask_user，收到工具结果后再生成最终文字。 */
  async function runTask(kind) {
    state.running = true; state.result = null
    const firstSeq = runtime.session.records.length
    runtime.model.requests.length = 0
    const choices = [{ id: 'sqlite', label: 'SQLite' }, { id: 'postgres', label: 'PostgreSQL' }]
    const question = kind === 'text' ? { kind, title: '项目名称是什么？' }
      : { kind, title: kind === 'single' ? '选择数据库' : '选择要演示的数据库', options: choices }
    try {
      runtime.agent.submit(JSON.stringify(question))
      await runtime.agent.idle()
      const events = runtime.session.read(firstSeq - 1)
      const tool = events.findLast(event => event.type === 'message/tool')
      const message = events.findLast(event => event.type === 'message/assistant')
      state.result = {
        message: message?.data.content, answer: tool?.data.content.value,
        toolResult: tool?.data, modelRequests: runtime.model.requests.length,
        reason: events.findLast(event => event.type === 'turn/end')?.data.reason,
      }
    } catch (error) { state.result = { error: error.message } }
    finally { state.running = false }
  }
  // 本机临时端口，JSON路由仅接受同源调用，不将此演示当作生产认证方案。
  const server = Bun.serve({ hostname: '127.0.0.1', port, async fetch(request) {
    const url = new URL(request.url)
    const json = (value, status = 200) => Response.json(value, { status })
    if (url.pathname === '/' && request.method === 'GET') return new Response(Bun.file(new URL('./index.html', import.meta.url)))
    if (url.pathname === '/state' && request.method === 'GET') return json(state)
    if (request.method !== 'POST') return json({ error: '路由不存在' }, 404)
    if (request.headers.get('origin') !== url.origin) return json({ error: '来源不合法' }, 403)
    try {
      const body = await request.json()
      if (url.pathname === '/tasks') {
        if (!['single', 'multiple', 'text'].includes(body.kind)) return json({ error: '未知问题类型' }, 400)
        if (state.running) return json({ error: '请先结束当前问答' }, 409)
        void runTask(body.kind)
        return json({ accepted: true }, 202)
      }
      if (url.pathname === '/answer') { questions.answer(owner, body.id, body.answer); return json({ ok: true }) }
      if (url.pathname === '/cancel-task') { runtime.agent.cancel(); return json({ ok: true }) }
      return json({ error: '路由不存在' }, 404)
    } catch (error) { return json({ error: error.message }, 400) }
  } })
  return { server, state, runtime, close: async () => {
    runtime.agent.cancel()
    try { await runtime.close() } finally { await server.stop(true) }
  } }
}

if (import.meta.main) {
  const app = startDemo()
  console.log('打开页面：' + app.server.url.href)
  console.log('真实Agent/Tools/Loop，固定演示模型；不调用外部API。Ctrl+C退出。')
  const stop = () => { void app.close() }
  process.once('SIGINT', stop); process.once('SIGTERM', stop)
}
