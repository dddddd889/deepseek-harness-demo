import { HarnessAgent } from "./agent.js";
import { LlmRuntime, ScriptedLlmProvider } from "./llm.js";
import { Session } from "./session.js";
const runtime = new LlmRuntime();
runtime.register('fake', new ScriptedLlmProvider([
    { type: 'text-delta', index: 0, text: 'Agent 已完成这一轮。' },
    { type: 'usage', usage: { inputTokens: 5, outputTokens: 6 } },
    { type: 'finish', reason: { kind: 'stop' } },
], 50));
const session = new Session();
const agent = new HarnessAgent(session, runtime, { provider: 'fake', model: 'debug-model' });
agent.onStatus(status => console.log('status:', status));
agent.send('运行一轮');
console.log('result:', await agent.run());
console.table(session.events.map(event => ({ seq: event.seq, type: event.type })));
//# sourceMappingURL=agent-demo.js.map