import { randomUUID } from 'node:crypto'
import { Tools } from '../../../../harness-own/src/tools.mjs'
import { Scope } from '../../../../harness-own/src/scope.mjs'
import { Events } from '../../../../harness-own/src/events.mjs'
import { Agent } from '../../../../harness-own/src/agent.mjs'
import { Settings } from '../../../../harness-own/src/config.mjs'

/** 注册真正的工具处理函数；模型只得到catalog中的schema，不直接调用Questions。 */
export function registerAskUser(scope, tools, questions, owner) {
  return tools.register(scope, {
    name: 'ask_user',
    description: '向用户提问，等待单选、多选或文本答案后继续任务。',
    schema: {
      type: 'object', required: ['kind', 'title'], additionalProperties: false,
      properties: {
        kind: { type: 'string', enum: ['single', 'multiple', 'text'] },
        title: { type: 'string' },
        options: { type: 'array', items: {
          type: 'object', required: ['id', 'label'], additionalProperties: false,
          properties: { id: { type: 'string' }, label: { type: 'string' } },
        } },
      },
    },
    // Tools.execute提供当前任务的signal；取消Agent也会中止本次问答等待。
    async run(args, context) {
      return await questions.request(owner, args, context.signal)
    },
  })
}

/** 固定模型替身：第一次产生工具调用，第二次读取真实Loop回传的工具结果。 */
class QuestionDemoModel {
  requests = []
  async *stream(request) {
    this.requests.push(structuredClone(request.messages))
    const last = request.messages.at(-1)
    if (last?.role === 'tool') {
      yield { kind: 'text', text: '模型已收到工具结果：' + JSON.stringify(last.content) }
      yield { kind: 'finish', reason: 'stop' }
      return
    }
    // 演示任务用JSON指定问题，不请求外部模型，不伪装成模型自主理解自然语言。
    const question = JSON.parse(last.content)
    yield { kind: 'tool', id: 'call_' + randomUUID(), name: 'ask_user', arguments: question }
    yield { kind: 'finish', reason: 'tools' }
  }
}

/** 复用实际Agent、Loop和Tools；Events仍在内存，没有接Host或Journal。 */
export function createQuestionAgent(questions, owner) {
  const scope = new Scope(), tools = new Tools(), session = new Events(owner)
  const model = new QuestionDemoModel(), settings = new Settings()
  registerAskUser(scope, tools, questions, owner)
  const agent = new Agent(session, model, tools, settings)
  return { agent, session, tools, model, close: async () => {
    try { await agent.close() } finally { await scope.close() }
  } }
}
