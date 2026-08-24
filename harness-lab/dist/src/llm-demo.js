import { LlmRuntime, ScriptedLlmProvider } from "./llm.js";
import { runModelStep } from "./model-step.js";
import { foldTokenUsage } from "./projections.js";
import { Session } from "./session.js";
const runtime = new LlmRuntime();
runtime.register('fake', new ScriptedLlmProvider([
    { type: 'block-start', index: 0, blockType: 'reasoning' },
    { type: 'reasoning-delta', index: 0, text: '先确认问题。' },
    { type: 'block-start', index: 1, blockType: 'text' },
    { type: 'text-delta', index: 1, text: '这是可逐帧调试的回答。' },
    { type: 'usage', usage: { inputTokens: 12, outputTokens: 9, reasoningTokens: 4 } },
    { type: 'finish', reason: { kind: 'stop' } },
], 50));
const session = new Session();
session.append('turn/start', { turn: 1 });
session.append('step/start', { turn: 1, step: 1 });
const result = await runModelStep(runtime, session, 1, 1, {
    provider: 'fake', model: 'debug-model', messages: [],
}, new AbortController().signal);
session.append('step/end', { turn: 1, step: 1 });
session.append('turn/end', { turn: 1, reason: { kind: 'completed' } });
for (const event of session.events)
    console.log(event.seq, event.type);
console.log('finish:', result.finish.kind);
console.log('usage:', foldTokenUsage(session.events));
//# sourceMappingURL=llm-demo.js.map