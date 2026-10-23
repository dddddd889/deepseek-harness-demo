import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { Host } from './host.mjs'
import { product } from './product.mjs'
import { capabilities } from './capabilities.mjs'

/** 保留第000步的输入契约；最后CLI换成真实应用，不让入口永远停在回声。 */
export function input(argv) {
  const prompt = argv.join(' ').trim()
  if (!prompt) throw Error('用法：bun run start "你的任务"')
  return prompt
}

/** CLI是UI适配器，仍然组装同一个Host/Guard/Agent，没有第二套循环。 */
async function run(prompt) {
  const host = new Host(process.env.HARNESS_HOME ?? resolve('.data-cli'))
  product(host); capabilities(host)
  const record = process.env.HARNESS_SESSION ? host.open(process.env.HARNESS_SESSION) : host.create({ cwd: process.cwd() })
  if (process.env.DEEPSEEK_API_KEY) record.settings.set({ backend: 'deepseek', model: process.env.DSH_MODEL ?? 'deepseek-flash', keyRef: 'DEEPSEEK_API_KEY' })
  const terminal = createInterface({ input: process.stdin, output: process.stdout })
  const cancel = () => record.agent.cancel()
  process.on('SIGINT', cancel); terminal.on('SIGINT', cancel)
  console.log('会话：' + record.header.id)
  console.log('模型后端：' + (record.settings.snapshot().backend ?? 'offline（离线演示）'))
  const unsubscribe = record.session.on(event => {
    console.log(event.seq, event.type, JSON.stringify(event.data))
    if (event.type === 'approval/request') void terminal.question('允许这次副作用？输入 yes：').then(answer => record.approvals.answer(record.header.id, event.data.id, answer.trim() === 'yes')).catch(() => {})
  })
  try {
    record.agent.submit(prompt); await record.agent.idle()
    const reason = record.session.read().filter(event => event.type === 'turn/end').at(-1)?.data.reason
    process.exitCode = reason === 'completed' ? 0 : reason === 'cancelled' ? 130 : 1
  } finally { unsubscribe(); process.off('SIGINT', cancel); terminal.close(); await host.close() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await run(input(process.argv.slice(2))) }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
