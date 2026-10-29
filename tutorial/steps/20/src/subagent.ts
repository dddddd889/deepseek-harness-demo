import type { Model } from './domain';
import { Tools, registerRead } from './tools';
import { Session } from './session';
import { runAgent } from './agent';
// 子 Agent 使用独立历史和只读工具，不继承父工具表，因此不能递归创建子 Agent。
export function registerSubagent(tools: Tools, workspace: string, model: Model) {
  return tools.register({ name: 'delegate_read', description: '委派一个只读子任务，最多 3 次模型请求', mutates: false,
    parameters: { type: 'object', properties: { task: { type: 'string' } }, required: ['task'], additionalProperties: false },
    async run(args, signal) {
      if (typeof args.task !== 'string' || !args.task.trim() || args.task.length > 4000) throw new Error('子任务非法');
      const childTools = new Tools(); registerRead(childTools, workspace);
      const session = new Session();
      const reason = await runAgent({ session, model, tools: childTools, prompt: args.task, signal, maxSteps: 3 });
      if (reason !== 'stop') throw new Error('子任务结束：' + reason);
      return (session.messages.at(-1)?.content ?? '').slice(0, 16_000);
    } });
}
