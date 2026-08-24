import { HarnessAgent } from './agent.ts'
import type { GenerateOptions, LlmProvider } from './llm.ts'
import { LlmRuntime } from './llm.ts'
import type { StreamChunk } from './domain.ts'
import { Session } from './session.ts'
import { ToolRegistry } from './tools.ts'

const responses: readonly (readonly StreamChunk[])[] = [
  [
    { type: 'tool-call-delta', index: 0, id: 'sum-1', name: 'sum', argumentsDelta: '{"a":20,"b":22}' },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ],
  [
    { type: 'text-delta', index: 0, text: '工具返回 42。' },
    { type: 'finish', reason: { kind: 'stop' } },
  ],
]
let responseIndex = 0
const provider: LlmProvider = {
  async *stream(options: GenerateOptions) {
    console.log(`模型请求 ${responseIndex + 1}，历史消息数：${options.messages.length}`)
    const response = responses[responseIndex++]
    if (!response) throw new Error('演示脚本耗尽')
    for (const chunk of response) yield chunk
  },
}

const runtime = new LlmRuntime()
runtime.register('fake', provider)
const tools = new ToolRegistry()
tools.register({
  name: 'sum', description: '两数相加',
  parameters: {
    type: 'object', required: ['a', 'b'], additionalProperties: false,
    properties: { a: { type: 'number' }, b: { type: 'number' } },
  },
  async execute(args) {
    if (typeof args !== 'object' || args === null || Array.isArray(args)) throw new Error('参数类型错误')
    return Number(args.a) + Number(args.b)
  },
})

const session = new Session()
const agent = new HarnessAgent(session, runtime, { provider: 'fake', model: 'debug-model' }, tools)
agent.send('20 + 22 等于多少？')
console.log('结果：', await agent.run())
console.table(session.events.map(event => ({ seq: event.seq, type: event.type })))
