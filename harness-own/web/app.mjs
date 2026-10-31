import { View } from '/view.mjs'

// UI只管理连接和视图，不在浏览器里运行Agent Loop或保存模型Key。
const element = id => document.getElementById(id)
let socket, generation = 0, identity = localStorage.getItem('harness.session'), view = new View(), serial = 0
const pending = new Map()
/** 所有按钮调用同一RPC入口；断线不自动重发prompt。 */
export function rpc(method, params = {}) {
  if (socket?.readyState !== WebSocket.OPEN) return Promise.reject(Error('尚未连接'))
  const id = ++serial
  return new Promise((resolve, reject) => { const timer = setTimeout(() => { pending.delete(id); reject(Error('请求超时')) }, 120_000); pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params })) })
}
/** 显示任何文本都用textContent，工具/网页内容不能执行HTML。 */
function text(tag, value) { const node = document.createElement(tag); node.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2); return node }
function button(label, action) { const node = text('button', label); node.onclick = () => action().catch(showError); return node }
function showError(error) { element('error').textContent = error.message }
function render() {
  const state = view.state()
  element('messages').replaceChildren(...state.messages.map(message => {
    const article = document.createElement('article'); article.append(text('strong', message.role), text('div', message.content))
    for (const block of message.thinking ?? []) { const details = document.createElement('details'); details.append(text('summary', '推理'), text('pre', block.text)); article.append(details) }
    return article
  }))
  element('stream').textContent = state.text
  element('tools').replaceChildren(...state.tools.map(tool => text('pre', tool)))
  element('approvals').replaceChildren(...state.approvals.map(approval => {
    const box = document.createElement('article'); box.append(text('pre', approval.question), button('允许一次', () => rpc('approval.answer', { id: identity, approvalId: approval.id, allow: true })), button('拒绝', () => rpc('approval.answer', { id: identity, approvalId: approval.id, allow: false }))); return box
  }))
}
async function choose(id) {
  identity = id; localStorage.setItem('harness.session', id); view = new View(); const current = view.reconnect()
  const records = await rpc('session.watch', { id, after: -1 }); records.forEach(event => view.apply(event, current)); render(); element('title').textContent = id
}
async function list() {
  const rows = await rpc('session.list')
  element('sessions').replaceChildren(...rows.map(row => { const li = document.createElement('li'); li.append(button(row.title, () => choose(row.id))); return li }))
}
function connect() {
  const connection = ++generation; element('connection').textContent = '连接中'
  socket = new WebSocket(location.origin.replace(/^http/, 'ws') + '/rpc')
  socket.onopen = async () => { if (connection !== generation) return; element('connection').textContent = '已连接'; try { await list(); if (identity) await choose(identity) } catch (error) { showError(error) } }
  socket.onmessage = event => {
    if (connection !== generation) return
    const message = JSON.parse(event.data)
    if (message.method === 'session.event' && message.params.sessionId === identity) { view.apply(message.params); render() }
    else if (pending.has(message.id)) { const waiting = pending.get(message.id); pending.delete(message.id); clearTimeout(waiting.timer); if (message.error) waiting.reject(Error(message.error.message)); else waiting.resolve(message.result) }
  }
  socket.onclose = () => { if (connection !== generation) return; for (const waiting of pending.values()) { clearTimeout(waiting.timer); waiting.reject(Error('连接断开，任务不自动重发')) }; pending.clear(); element('connection').textContent = '断开，正在重连'; setTimeout(connect, 700) }
}
/** 接收成功后清空草稿；离线或失败保留输入方便重试。 */
async function send(destination = 'turn') {
  if (!identity) throw Error('请先创建会话')
  const content = element('prompt').value.trim(); if (!content) return
  await rpc('session.submit', { id: identity, content, destination }); element('prompt').value = ''
}
element('create').onclick = async () => { try { const header = await rpc('session.create', { cwd: element('cwd').value }); await list(); await choose(header.id) } catch (error) { showError(error) } }
element('send').onclick = () => send().catch(showError)
element('steer').onclick = () => send('step').catch(showError)
element('cancel').onclick = () => rpc('session.cancel', { id: identity }).catch(showError)
element('permission').onchange = () => rpc('settings.set', { id: identity, patch: { permission: element('permission').value } }).catch(showError)
element('rename').onclick = async () => { const title = prompt('新标题'); if (title) { await rpc('session.metadata', { id: identity, patch: { title } }); await list() } }
element('archive').onclick = async () => { await rpc('session.metadata', { id: identity, patch: { archived: true } }); await list() }
document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void send().catch(showError) } })
connect()
