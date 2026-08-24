import assert from 'node:assert/strict'
import { test } from 'bun:test'
import { InProcessSubagentProvider, SubagentRuntime } from './subagents.ts'
import { WorkflowEngine } from './workflow.ts'

function engine(execute?: ConstructorParameters<typeof InProcessSubagentProvider>[1]) {
  const subagents = new SubagentRuntime()
  subagents.register(new InProcessSubagentProvider('inproc', execute ?? (async request => ({
    output: [{ type: 'text', text: request.prompt[0]?.type === 'text' ? request.prompt[0].text : '' }],
    stopReason: 'completed',
  }))))
  return { subagents, workflows: new WorkflowEngine(subagents) }
}

const request = (script: string) => ({
  script,
  meta: { name: 'parallel-research', description: '并行调研', phases: [{ title: 'research' }] },
  subagentProvider: 'inproc', parentSession: 'root', parentDepth: 0,
})

test('工作线程脚本动态并发智能体，并产生完整生命周期', async () => {
  let active = 0
  let peak = 0
  const { workflows } = engine(async request => {
    active += 1
    peak = Math.max(peak, active)
    await new Promise(resolve => setTimeout(resolve, 10))
    active -= 1
    return { output: [{ type: 'text', text: `done:${request.prompt[0]?.type === 'text' ? request.prompt[0].text : ''}` }], stopReason: 'completed' }
  })
  const events: string[] = []
  workflows.onEvent(event => events.push(event.type))
  const run = workflows.start(request(`
    phase('research')
    const results = await Promise.all([
      agent({ prompt: 'A', label: 'alpha', phase: 'research' }),
      agent({ prompt: 'B', label: 'beta', phase: 'research' })
    ])
    log('joined')
    return { count: results.length }
  `))
  const result = await run.result
  assert.deepEqual(result, { value: { count: 2 }, stopReason: 'completed', agentsStarted: 2 })
  assert.equal(peak, 2)
  assert.equal(events[0], 'start')
  assert.equal(events.at(-1), 'end')
  assert.equal(events.filter(type => type === 'agent-start').length, 2)
  assert.equal(events.filter(type => type === 'agent-end').length, 2)
})

test('最大并发智能体数限制并发，但不改变脚本的并行等待语义', async () => {
  let active = 0
  let peak = 0
  const { workflows } = engine(async () => {
    active += 1; peak = Math.max(peak, active)
    await new Promise(resolve => setTimeout(resolve, 5)); active -= 1
    return { output: [{ type: 'text', text: 'ok' }], stopReason: 'completed' }
  })
  const run = workflows.start({
    ...request(`return await Promise.all([agent({prompt:'1'}), agent({prompt:'2'}), agent({prompt:'3'})])`),
    maxConcurrentAgents: 1, maxTotalAgents: 3,
  })
  assert.equal((await run.result).stopReason, 'completed')
  assert.equal(peak, 1)
})

test('超过智能体总数上限时以拒绝方式失败，并取消已启动的子智能体', async () => {
  const { workflows } = engine(async (_request, signal) => {
    await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
    return { output: [], stopReason: 'completed' }
  })
  const run = workflows.start({
    ...request(`return await Promise.all([agent({prompt:'1'}), agent({prompt:'2'}), agent({prompt:'3'})])`),
    maxTotalAgents: 2, maxConcurrentAgents: 2, cancelGraceMs: 100,
  })
  const result = await run.result
  assert.equal(result.stopReason, 'cancelled')
  assert.match(result.error ?? '', /maxTotalAgents=2/)
})

test('未声明阶段会导致取消，工作线程忙循环则在宽限期后强制收敛', async () => {
  const { workflows } = engine()
  const badPhase = await workflows.start(request(`phase('unknown'); return 1`)).result
  assert.equal(badPhase.stopReason, 'cancelled')
  assert.match(badPhase.error ?? '', /未声明/)

  const busy = workflows.start({ ...request(`while (true) {}`), cancelGraceMs: 20 })
  setTimeout(() => busy.cancel('operator stop'), 10)
  const stopped = await busy.result
  assert.equal(stopped.stopReason, 'cancelled')
  assert.equal(stopped.error, 'operator stop')
})

test('子智能体未完成时映射为空值，脚本仍可显式决定结果', async () => {
  const { workflows } = engine(async () => ({ output: [{ type: 'text', text: 'partial' }], stopReason: 'error' }))
  const result = await workflows.start(request(`
    const child = await agent({ prompt: 'fails' })
    return { childWasNull: child === null }
  `)).result
  assert.deepEqual(result, { value: { childWasNull: true }, stopReason: 'completed', agentsStarted: 1 })
})
