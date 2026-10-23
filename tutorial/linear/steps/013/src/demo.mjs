import { Events } from './events.mjs'
import { Tools } from './tools.mjs'
import { Scope } from './scope.mjs'
import { Settings } from './config.mjs'
import { Agent } from './agent.mjs'
import { ScriptModel, answer, call } from './model.mjs'

// 这是当前已实现能力的演示入口，尚未接真实模型，输出明确标注固定模型。
const text = process.argv.slice(2).join(' ') || '/sum 2 3'
const numbers = text.match(/^\/sum (\d+) (\d+)$/)
const script = numbers ? [call('sum', { a: Number(numbers[1]), b: Number(numbers[2]) }), answer(String(Number(numbers[1]) + Number(numbers[2])))] : text === '/slow' ? ['hang'] : [answer('固定模型收到：' + text)]
const session = new Events(), tools = new Tools(), scope = new Scope()
tools.register(scope, { name: 'sum', effect: 'read', schema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'], additionalProperties: false }, run: ({ a, b }) => a + b })
const agent = new Agent(session, new ScriptModel(script), tools, new Settings())
session.on(event => console.log(event.seq, event.type, JSON.stringify(event.data)))
process.on('SIGINT', () => agent.cancel())
try { agent.submit(text); await agent.idle() }
finally { await agent.close(); await scope.close() }
