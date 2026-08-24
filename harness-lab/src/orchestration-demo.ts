import { LocalJobRegistry } from './jobs.ts'
import { InProcessSubagentProvider, SubagentRuntime } from './subagents.ts'
import { WorkflowEngine } from './workflow.ts'

const subagents = new SubagentRuntime()
subagents.register(new InProcessSubagentProvider('debug-child', async (request, signal) => {
  signal.throwIfAborted()
  const prompt = request.prompt[0]?.type === 'text' ? request.prompt[0].text : ''
  await new Promise(resolve => setTimeout(resolve, 20))
  return { output: [{ type: 'text', text: `child(${request.depth}) 完成：${prompt}` }], stopReason: 'completed' }
}))
subagents.onLifecycle(event => console.log('子智能体生命周期：', event))

const jobs = new LocalJobRegistry()
jobs.attachController()
jobs.onChanged(owner => console.log('后台任务变化：', owner, jobs.list(owner)))

const backgroundId = subagents.startJob(jobs, 'debug-child', {
  label: '后台调研', prompt: [{ type: 'text', text: '分析 Session 恢复' }],
  parentSession: 'root-session', parentDepth: 0,
})
console.log('后台任务：', backgroundId)
await jobs.wait(backgroundId, 1_000, 'root-session')
console.log('后台输出：', jobs.read(backgroundId, 'root-session'))

const workflows = new WorkflowEngine(subagents)
workflows.onEvent(event => console.log('工作流事件：', event))
const run = workflows.start({
  meta: { name: 'parallel-review', description: '并行审查', phases: [{ title: 'review' }] },
  script: `
    phase('review')
    const [architecture, recovery] = await Promise.all([
      agent({ prompt: '审查架构', label: 'architecture', phase: 'review' }),
      agent({ prompt: '审查恢复', label: 'recovery', phase: 'review' })
    ])
    log('所有 child 已汇合')
    return { architecture, recovery }
  `,
  subagentProvider: 'debug-child', parentSession: 'root-session', parentDepth: 0,
  maxConcurrentAgents: 2, maxTotalAgents: 2,
})
console.log('工作流结果：', await run.result)
await subagents.dispose()
await jobs.dispose()
