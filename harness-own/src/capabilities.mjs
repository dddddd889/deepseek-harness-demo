import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Scope } from './scope.mjs'
import { Jobs } from './jobs.mjs'
import { Skills } from './skills.mjs'
import { Collaboration } from './collaboration.mjs'
import { Subagents } from './subagents.mjs'
import { workflow } from './workflow.mjs'
import { runProgram } from './ptc.mjs'
import { execute } from './process.mjs'
import { Sandbox } from './sandbox.mjs'
import { Web } from './web-tools.mjs'
import { Attachments, present } from './attachments.mjs'
import { Terminal } from './terminal.mjs'

/** 接线这一步只组合前面已运行的领域，不再引入第二套工具表。 */
export function capabilities(host) {
  const previousOpen = host.open.bind(host)
  host.open = (id, owner = 'local') => {
    const record = previousOpen(id, owner)
    if (record.capabilities) return record
    record.capabilities = true
    const { scope, tools, session, header, settings, agent } = record
    const jobs = new Jobs(), collaboration = new Collaboration(session), skills = new Skills([join(host.home, 'skills'), join(header.cwd, '.skills')]), web = new Web(), attachments = new Attachments(join(host.home, 'attachments'))
    const sandbox = new Sandbox(), signalOf = context => context.signal
    const string = { type: 'string' }, number = { type: 'number' }, object = { type: 'object' }, array = { type: 'array', items: {} }
    const add = (name, effect, properties, run) => tools.register(scope, { name, description: name + '：参数见Schema', effect, exclusive: effect !== 'read', schema: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false }, run })
    // 项目规则成为可回放输入事实；不存在时只忽略ENOENT。
    let rules = ''
    try { rules = readFileSync(join(header.cwd, 'AGENTS.md'), 'utf8') } catch (error) { if (error.code !== 'ENOENT') throw error }
    session.append('context/instructions', { path: join(header.cwd, 'AGENTS.md'), content: rules })
    if (rules) settings.set({ system: rules })
    add('run', 'execute', { command: string, args: array }, (args, context) => execute(sandbox.wrap({ command: args.command, args: args.args, cwd: header.cwd }, { workspace: header.cwd, mode: settings.snapshot().sandbox ?? 'workspace-write' }), context.signal))
    add('job_start', 'execute', { command: string, args: array }, (args, context) => ({ id: jobs.start(scope, session.id, (signal, emit) => execute(sandbox.wrap({ command: args.command, args: args.args, cwd: header.cwd }, { workspace: header.cwd }), signal, emit)) }))
    add('job_wait', 'read', { id: string, timeout: number }, args => jobs.wait(session.id, args.id, args.timeout))
    add('job_read', 'read', { id: string, cursor: number }, args => jobs.read(session.id, args.id, args.cursor))
    add('job_kill', 'execute', { id: string }, args => jobs.kill(session.id, args.id))
    add('skill_load', 'read', { name: string }, async args => { await skills.discover(); return skills.load(args.name, session) })
    add('web_fetch', 'network', { url: string }, (args, context) => web.fetchText(args.url, context.signal))
    add('web_search', 'network', { query: string }, (args, context) => web.search(args.query, context.signal))
    add('workflow', 'execute', { nodes: array }, (args, context) => workflow(args.nodes, tools, context))
    add('run_program', 'execute', { program: array }, (args, context) => runProgram(args.program, tools, context))
    for (const kind of ['todo', 'plan', 'goal', 'schedule']) add(kind + '_update', 'write', { value: object }, args => { collaboration.set(kind, args.value); return collaboration.state(kind) })
    add('present', 'read', { path: string, mediaType: string }, async args => present(session, attachments, await record.fs.path(args.path), args.mediaType))
    const children = new Subagents(async () => {
      const child = host.create({ cwd: header.cwd, owner, title: '子任务' })
      agent.children.add(child.agent)
      scope.own(async () => { agent.children.delete(child.agent); await host.closeSession(child.header.id, owner) })
      return child.agent
    })
    add('subagent_create', 'execute', { task: string }, async args => { const id = await children.create(scope, session.id); children.send(session.id, id, args.task); return { id } })
    add('subagent_send', 'execute', { id: string, text: string }, args => ({ receipt: children.send(session.id, args.id, args.text) }))
    add('subagent_wait', 'read', { id: string }, args => children.wait(session.id, args.id))
    add('subagent_interrupt', 'execute', { id: string }, args => { children.interrupt(session.id, args.id); return {} })
    record.domains = { jobs, skills, collaboration, children, attachments }
    return record
  }
}
