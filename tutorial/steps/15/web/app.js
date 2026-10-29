// Renderer 只认识 HTTP 和领域事件，不拿 API Key，也不直接读文件。
const $ = selector => document.querySelector(selector);
let sessionId = '';
let stream;
let cursor = 0;
const pending = new Map();
async function api(path, data) {
  const response = await fetch(path, { method: data === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}
function showError(error) { $('#status').textContent = String(error); }
function renderApprovals() {
  $('#approvals').replaceChildren();
  for (const [id, event] of pending) {
    const row = document.createElement('p');
    const title = document.createElement('span');
    title.textContent = '等待审批：' + JSON.stringify(event.data.call.function);
    row.append(title);
    for (const [label, allow] of [['允许一次', true], ['拒绝', false]]) {
      const button = document.createElement('button'); button.textContent = label;
      button.onclick = () => { void api(`/api/sessions/${sessionId}/approvals`, { id, allow }).catch(showError); };
      row.append(button);
    }
    $('#approvals').append(row);
  }
}
function apply(event) {
  // 重连可能重放已有事件；按会话序号去重。
  if (event.seq <= cursor) return;
  if (event.seq !== cursor + 1) { void openSession(sessionId).catch(showError); return; }
  cursor = event.seq;
  if (event.type === 'messages') {
    for (const message of event.data.messages) if (message.role === 'user') $('#output').textContent += '\n你：' + message.content + '\n';
  }
  if (event.type === 'text') $('#output').textContent += event.data.text;
  if (event.type === 'tool_start') $('#output').textContent += '\n工具：' + event.data.call.function.name + '\n';
  if (event.type === 'tool_end') $('#output').textContent += '\n结果：' + event.data.result + '\n';
  if (event.type === 'start') { $('#status').textContent = '执行中'; $('#send').disabled = true; }
  if (event.type === 'approval') pending.set(event.data.id, event);
  if (event.type === 'approval_resolved') pending.delete(event.data.id);
  if (event.type === 'done') {
    $('#status').textContent = '结束：' + event.data.reason + (event.data.error ?? ''); $('#send').disabled = false;
    for (const [id, item] of pending) if (item.turnId === event.turnId) pending.delete(id);
  }
  renderApprovals();
}
async function openSession(id) {
  stream?.close(); sessionId = id; cursor = 0; pending.clear(); $('#output').textContent = '';
  const snapshot = await api('/api/sessions/' + id);
  for (const event of snapshot.events) apply(event);
  $('#send').disabled = snapshot.busy;
  localStorage.setItem('harness-session', id); $('#sessions').value = id;
  // 浏览器自动重连时发送 Last-Event-ID；新连接使用 after 补足快照之后的事件。
  stream = new EventSource(`/api/sessions/${id}/events?after=${cursor}`);
  stream.onmessage = message => { if (sessionId === id) apply(JSON.parse(message.data)); };
  stream.onerror = () => { $('#status').textContent = '连接中断，正在重连；可刷新恢复历史'; };
}
async function refresh() {
  const sessions = await api('/api/sessions');
  $('#sessions').replaceChildren(...sessions.map(session => {
    const option = document.createElement('option'); option.value = session.id; option.textContent = session.id; return option;
  }));
  return sessions;
}
$('#new').onclick = () => { void (async () => {
  const session = await api('/api/sessions', {}); await refresh(); await openSession(session.id);
})().catch(showError); };
$('#sessions').onchange = () => { void openSession($('#sessions').value).catch(showError); };
$('#send').onclick = () => { void (async () => {
  const prompt = $('#prompt').value.trim(); if (!prompt) throw new Error('请输入任务');
  $('#send').disabled = true;
  // 网络结果不确定时，重试必须保留同一个 requestId，不能生成新任务。
  const body = { prompt, requestId: crypto.randomUUID() };
  try { await api(`/api/sessions/${sessionId}/prompts`, body); }
  catch { await api(`/api/sessions/${sessionId}/prompts`, body); }
  $('#prompt').value = '';
})().catch(error => { $('#send').disabled = false; showError(error); }); };
$('#cancel').onclick = () => { void api(`/api/sessions/${sessionId}/cancel`, {}).catch(showError); };
void (async () => {
  const sessions = await refresh();
  const remembered = localStorage.getItem('harness-session');
  if (sessions.length) await openSession(sessions.find(session => session.id === remembered)?.id ?? sessions[0].id);
  else $('#new').click();
})().catch(showError);
