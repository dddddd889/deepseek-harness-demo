import { Host } from './host.mjs'
import { DeepSeekModel } from './deepseek.mjs'
import { startHTTP } from './http.mjs'

if (!process.env.HARNESS_HOME) throw Error('请显式设置HARNESS_HOME，避免与日常数据混用')
const host = new Host(process.env.HARNESS_HOME, process.env.DEEPSEEK_API_KEY ? () => new DeepSeekModel({ key: process.env.DEEPSEEK_API_KEY, model: process.env.DSH_MODEL ?? 'deepseek-flash' }) : undefined)
const web = await startHTTP(host, { port: Number(process.env.HARNESS_PORT ?? 0) })
console.log('打开：' + web.bootstrap)
let closing = false
const close = async () => { if (closing) return; closing = true; await web.close(); await host.close() }
process.on('SIGINT', close); process.on('SIGTERM', close)
