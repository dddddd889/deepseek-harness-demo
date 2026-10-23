import { Events } from './events.mjs'
import { Tools } from './tools.mjs'
import { Scope } from './scope.mjs'
import { Settings } from './config.mjs'
import { Agent } from './agent.mjs'
import { ScriptModel, answer, call } from './model.mjs'
import { DeepSeekModel } from './deepseek.mjs'

// 同一个演示入口：有Key时请求DeepSeek的OpenAI兼容接口，无Key时运行固定模型。
const text = process.argv.slice(2).join(' ') || '/sum 2 3'
const numbers = text.match(/^\/sum (\d+) (\d+)$/)
const script = numbers ? [call('sum', { a: Number(numbers[1]), b: Number(numbers[2]) }), answer(String(Number(numbers[1]) + Number(numbers[2])))] : text === '/slow' ? ['hang'] : [answer('固定模型收到：' + text)]
const session = new Events(), tools = new Tools(), scope = new Scope()
tools.register(scope, { name: 'sum', effect: 'read', schema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'], additionalProperties: false }, run: ({ a, b }) => a + b })
// 先跑固定用例；显式设置凭据后，同一入口直接替换提供方。
const model = process.env.DEEPSEEK_API_KEY ? new DeepSeekModel({ key: process.env.DEEPSEEK_API_KEY, baseURL: process.env.DEEPSEEK_BASE_URL, model: process.env.DSH_MODEL ?? 'deepseek-flash' }) : new ScriptModel(script)
const agent = new Agent(session, model, tools, new Settings())
session.on(event => console.log(event.seq, event.type, JSON.stringify(event.data)))
process.on('SIGINT', () => agent.cancel())
try { agent.submit(text); await agent.idle() }
finally { await agent.close(); await scope.close() }