import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { Events, id } from './events.mjs'
import { Journal } from './journal.mjs'
import { Agent } from './agent.mjs'
import { Scope } from './scope.mjs'
import { Settings } from './config.mjs'
import { Tools } from './tools.mjs'
import { LocalFS } from './filesystem.mjs'
import { fileTools } from './file-tools.mjs'
import { Approvals } from './approval.mjs'
import { permissionGuard } from './permissions.mjs'
import { installBatch } from './batch.mjs'
import { messages } from './projection.mjs'

/** 离线演示提供方明确标注用途；它只替换外部模型，所有宿主执行走真实实现。 */
export class OfflineModel {
  async *stream(request) {
    const last = request.messages.at(-1)
    if (last?.content === '/slow') { yield { kind: 'text', text: 'partial' }; await delay(60_000, undefined, { signal: request.signal }); return }
    if (last?.role === 'tool') yield { kind: 'text', text: JSON.stringify(last.content) }
    else {
      const match = String(last?.content ?? '').match(/^\/tool ([a-zA-Z0-9_]+) (.+)$/s)
      if (match) { yield { kind: 'tool', id: id('call'), name: match[1], arguments: JSON.parse(match[2]) }; yield { kind: 'finish', reason: 'tools' }; return }
      yield { kind: 'text', text: '[离线演示] ' + (last?.content ?? '') }
    }
    yield { kind: 'finish', reason: 'stop' }
  }
}

/** Host组合现有领域；UI、ACP与SDK都不能在外层另写一套Loop。 */
export class Host {
  loaded = new Map()
  constructor(home, modelFactory = () => new OfflineModel()) {
    this.home = resolve(home); this.modelFactory = modelFactory
    mkdirSync(join(this.home, 'sessions'), { recursive: true })
  }
  /** 用户授权后的cwd成为工作区边界，不从模型文本猜。 */
  create({ cwd, owner = 'local', title = '新会话' }) {
    const sessionId = id('session'), root = join(this.home, 'sessions', sessionId)
    mkdirSync(root)
    const header = { id: sessionId, owner, title, cwd: resolve(cwd), createdAt: Date.now(), archived: false }
    writeFileSync(join(root, 'header.json'), JSON.stringify(header), { flag: 'wx' })
    return this.open(sessionId, owner)
  }
  /** 每次读取/控制都校验owner，不能只在UI隐藏按钮。 */
  header(sessionId, owner) {
    if (!/^session_[a-f0-9-]+$/.test(sessionId)) throw Error('会话身份不合法')
    const header = JSON.parse(readFileSync(join(this.home, 'sessions', sessionId, 'header.json'), 'utf8'))
    if (header.owner !== owner) throw Error('没有会话权限')
    return header
  }
  /** 冷列表只读metadata，不恢复Agent或请求模型。 */
  list(owner, { offset = 0, limit = 50, archived = false } = {}) {
    return readdirSync(join(this.home, 'sessions')).map(name => {
      try { return this.header(name, owner) } catch { return undefined }
    }).filter(row => row && row.archived === archived).sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id)).slice(offset, offset + Math.min(limit, 100))
  }
  /** 恢复时中断的工具结果不能假定未执行，也不自动重做。 */
  open(sessionId, owner = 'local') {
    const header = this.header(sessionId, owner)
    if (this.loaded.has(sessionId)) return this.loaded.get(sessionId)
    const journal = new Journal(join(this.home, 'sessions', sessionId, 'events.jsonl'))
    const session = new Events(sessionId, event => journal.append(event)); session.records = structuredClone(journal.records)
    const lastStart = session.records.findLastIndex(event => event.type === 'turn/start'), lastEnd = session.records.findLastIndex(event => event.type === 'turn/end')
    if (lastStart > lastEnd) session.append('turn/end', { turnId: session.records[lastStart].data.turnId, reason: 'interrupted', toolOutcome: 'UNKNOWN_DO_NOT_REPLAY' })
    const scope = new Scope(), tools = new Tools(), settings = new Settings({ permission: 'ask' }), fs = new LocalFS(header.cwd)
    fileTools(scope, tools, fs); installBatch(tools)
    const approvals = new Approvals(event => session.append(event.type, event))
    tools.guard = permissionGuard(settings, approvals)
    const agent = new Agent(session, this.modelFactory(header), tools, settings)
    const record = { header, session, journal, agent, tools, scope, settings, approvals, fs }
    this.loaded.set(sessionId, record)
    return record
  }
  /** 产品metadata变更不会混入模型对话。 */
  metadata(sessionId, owner, patch) {
    const header = this.header(sessionId, owner)
    if (patch.title !== undefined) header.title = String(patch.title)
    if (patch.archived !== undefined) header.archived = !!patch.archived
    writeFileSync(join(this.home, 'sessions', sessionId, 'header.json'), JSON.stringify(header))
    if (this.loaded.has(sessionId)) this.loaded.get(sessionId).header = header
    return header
  }
  /** 一个会话关闭不影响别的会话，日志保留可恢复。 */
  async closeSession(sessionId, owner) {
    this.header(sessionId, owner)
    const record = this.loaded.get(sessionId)
    if (!record) return
    const errors = []
    try { await record.agent.close() } catch (error) { errors.push(error) }
    try { await record.scope.close() } catch (error) { errors.push(error) }
    try { record.journal.close() } catch (error) { errors.push(error) }
    this.loaded.delete(sessionId)
    if (errors.length) throw new AggregateError(errors, '会话退出失败，其他资源已继续清理')
  }
  async close() {
    const results = await Promise.allSettled([...this.loaded.values()].map(record => this.closeSession(record.header.id, record.header.owner)))
    const errors = results.filter(result => result.status === 'rejected').map(result => result.reason)
    if (errors.length) throw new AggregateError(errors, 'Host退出有错误，已尝试关闭全部会话')
  }
}
