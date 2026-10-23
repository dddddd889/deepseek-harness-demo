import { join } from 'node:path'
import { Credentials, Store, Workspaces } from './storage.mjs'
import { DeepSeekModel } from './deepseek.mjs'
import { OfflineModel } from './host.mjs'

/** 让产品设置真正落到请求边界，模型目录不是一个不生效的下拉框。 */
export function product(host) {
  const credentials = new Credentials(join(host.home, 'credentials.json')), workspaces = new Workspaces(join(host.home, 'workspaces.json'))
  const previousOpen = host.open.bind(host), originalFactory = host.modelFactory
  host.modelFactory = header => ({ async *stream(request) {
    const route = request.config.backend ?? 'offline'
    if (route === 'offline') yield* new OfflineModel().stream(request)
    else if (route === 'deepseek') yield* new DeepSeekModel({ key: credentials.resolve(request.config.keyRef ?? 'DEEPSEEK_API_KEY'), model: request.config.model ?? 'deepseek-flash', baseURL: request.config.baseURL }).stream(request)
    else throw Error('未知backend：' + route)
  } })
  host.open = (id, principal = 'local') => {
    const record = previousOpen(id, principal)
    if (!record.product) {
      const store = new Store(join(host.home, 'sessions', id, 'settings.json')), set = record.settings.set.bind(record.settings)
      set(store.read())
      record.settings.set = patch => { store.update(value => ({ ...value, ...structuredClone(patch) })); set(patch) }
      record.product = true
    }
    return record
  }
  const previousAttach = host.attachPeer
  host.attachPeer = (peer, principal) => {
    const disposers = [], bind = (method, handler) => disposers.push(peer.handle(method, handler)), record = id => host.open(id, principal)
    const earlier = previousAttach?.(peer, principal); if (earlier) disposers.push(earlier)
    bind('credentials.list', () => credentials.list())
    bind('credentials.set', params => credentials.set(params.ref, params.secret))
    bind('credentials.remove', params => { credentials.remove(params.ref); return {} })
    bind('workspace.list', () => workspaces.list())
    bind('workspace.add', params => ({ id: workspaces.add(params.path, params.title) }))
    bind('workspace.update', params => { workspaces.update(params.id, params.patch); return {} })
    bind('session.queue', params => record(params.id).agent.inbox.pending())
    for (const name of ['read', 'write', 'edit']) bind('file.' + name, params => {
      const current = record(params.id)
      return current.tools.execute({ id: 'manual-' + Date.now(), name, arguments: params.arguments }, { signal: new AbortController().signal, session: current.session })
    })
    return () => disposers.forEach(dispose => dispose())
  }
  return { credentials, workspaces }
}
