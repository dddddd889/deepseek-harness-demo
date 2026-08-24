import { LocalJobRegistry } from "./jobs.js";
import { InProcessSubagentProvider, SubagentRuntime } from "./subagents.js";
import { WorkflowEngine } from "./workflow.js";
const subagents = new SubagentRuntime();
subagents.register(new InProcessSubagentProvider('debug-child', async (request, signal) => {
    signal.throwIfAborted();
    const prompt = request.prompt[0]?.type === 'text' ? request.prompt[0].text : '';
    await new Promise(resolve => setTimeout(resolve, 20));
    return { output: [{ type: 'text', text: `child(${request.depth}) 完成：${prompt}` }], stopReason: 'completed' };
}));
subagents.onLifecycle(event => console.log('subagent lifecycle:', event));
const jobs = new LocalJobRegistry();
jobs.attachController();
jobs.onChanged(owner => console.log('jobs changed:', owner, jobs.list(owner)));
const backgroundId = subagents.startJob(jobs, 'debug-child', {
    label: '后台调研', prompt: [{ type: 'text', text: '分析 Session 恢复' }],
    parentSession: 'root-session', parentDepth: 0,
});
console.log('background job:', backgroundId);
await jobs.wait(backgroundId, 1_000, 'root-session');
console.log('background output:', jobs.read(backgroundId, 'root-session'));
const workflows = new WorkflowEngine(subagents);
workflows.onEvent(event => console.log('workflow event:', event));
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
});
console.log('workflow result:', await run.result);
await subagents.dispose();
await jobs.dispose();
//# sourceMappingURL=orchestration-demo.js.map