/** 一个领域控制器映射所有原生接入；外层只做传输/身份，不重写执行。 */
export function remote(peer, host, principal) {
  const subscriptions = new Map(), disposers = []
  const bind = (name, handler) => disposers.push(peer.handle(name, handler))
  const session = id => host.open(id, principal)
  bind('session.create', params => host.create({ cwd: params.cwd, owner: principal, title: params.title }).header)
  bind('session.list', params => host.list(principal, params ?? {}))
  bind('session.metadata', params => host.metadata(params.id, principal, params.patch))
  bind('session.read', params => session(params.id).session.read(params.after ?? -1))
  bind('session.submit', params => ({ inputId: session(params.id).agent.submit(params.content, params.destination ?? 'turn') }))
  bind('session.wait', async params => { const record = session(params.id); await record.agent.idle(); return record.session.read().filter(event => event.type === 'turn/end').at(-1)?.data })
  bind('session.cancel', async params => { const record = session(params.id); record.agent.cancel(); await record.agent.idle(); return {} })
  bind('session.edit', params => { session(params.id).agent.inbox.update(params.inputId, params.content); return {} })
  bind('session.removeInput', params => { session(params.id).agent.inbox.remove(params.inputId); return {} })
  bind('session.close', async params => { subscriptions.get(params.id)?.(); subscriptions.delete(params.id); await host.closeSession(params.id, principal); return {} })
  bind('approval.answer', params => { session(params.id).approvals.answer(params.id, params.approvalId, params.allow); return {} })
  bind('settings.set', params => { session(params.id).settings.set(params.patch); return session(params.id).settings.snapshot() })
  bind('tools.list', params => session(params.id).tools.catalog())
  bind('session.watch', params => {
    const record = session(params.id)
    subscriptions.get(params.id)?.()
    subscriptions.set(params.id, record.session.on(event => peer.notify('session.event', event)))
    return record.session.read(params.after ?? -1)
  })
  /** 断线取消订阅，不暗中取消仍在运行的会话；显式关闭Host才结束活动。 */
  const dispose = () => { for (const cancel of subscriptions.values()) cancel(); subscriptions.clear(); disposers.splice(0).forEach(remove => remove()) }
  const extra = host.attachPeer?.(peer, principal); if (extra) disposers.push(extra)
  peer.once('closed', dispose)
  return dispose
}
