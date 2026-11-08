import { Questions } from './questions.mjs'

/** 独立教学服务器，只演示问答等待链路，不冒充已接Host或外部模型。 */
export function startDemo(port = 0) {
  const state = { question: null, result: null, running: false }, owner = 'demo-session'
  let controller
  const questions = new Questions(event => {
    if (event.type === 'question/request') state.question = { id: event.id, ...event.question }
    if (event.type === 'question/settled') state.question = null
  })
  /** 模拟工具中的await：只有用户回答或取消后，这段任务才继续。 */
  async function runTask(kind) {
    state.running = true; state.result = null
    controller = new AbortController()
    const choices = [{ id: 'sqlite', label: 'SQLite' }, { id: 'postgres', label: 'PostgreSQL' }]
    const question = kind === 'text' ? { kind, title: '项目名称是什么？' }
      : { kind, title: kind === 'single' ? '选择数据库' : '选择要演示的数据库', options: choices }
    try {
      const answer = await questions.request(owner, question, controller.signal)
      state.result = { message: '等待已结束，调用方继续执行', answer }
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
      if (url.pathname === '/cancel-task') { controller?.abort(); return json({ ok: true }) }
      return json({ error: '路由不存在' }, 404)
    } catch (error) { return json({ error: error.message }, 400) }
  } })
  return { server, state, close: async () => { controller?.abort(); await server.stop(true) } }
}

if (import.meta.main) {
  const app = startDemo()
  console.log('打开页面：' + app.server.url.href)
  console.log('此处演示等待与恢复，不调用外部模型。Ctrl+C退出。')
  const stop = () => { void app.close() }
  process.once('SIGINT', stop); process.once('SIGTERM', stop)
}
