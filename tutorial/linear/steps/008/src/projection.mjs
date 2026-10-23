/** 只投影已提交内容；流式分片是显示状态，不自行进入模型历史。 */
export function messages(events) {
  return events.filter(event => ['message/user', 'message/assistant', 'message/tool'].includes(event.type))
    .map(event => structuredClone(event.data))
}

/** Fork 保留完整事实前缀与 lineage，不修改父历史。 */
export function fork(parent, child, through) {
  if (!Number.isSafeInteger(through) || through < -1 || through >= parent.records.length) throw Error('fork 位置不合法')
  child.append('lineage', { parent: parent.id, through })
  for (const event of parent.read().filter(event => event.seq <= through)) {
    if (event.type.startsWith('message/')) child.append(event.type, event.data)
  }
  return child
}

/** 查询只读日志，不创建 Agent，不产生模型调用。 */
export function search(sessions, query) {
  return sessions.flatMap(session => session.read().filter(event => JSON.stringify(event.data).includes(query))
    .map(event => ({ sessionId: session.id, seq: event.seq, data: event.data })))
}
