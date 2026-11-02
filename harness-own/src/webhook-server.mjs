import { mkdtempSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { Host } from './host.mjs'
import { startWebhook } from './webhook-http.mjs'

// 必须显式配置本地演示secret；不用真实账号密钥，不把secret打印到日志。
const secret = process.env.HARNESS_WEBHOOK_SECRET
if (!secret) throw Error('请先设置HARNESS_WEBHOOK_SECRET')
// 默认每次创建独立数据目录并保留日志，演示不会复用其他学习会话。
mkdirSync(resolve('tmp'), { recursive: true })
const home = process.env.HARNESS_WEBHOOK_HOME ?? mkdtempSync(join(resolve('tmp'), 'webhook-061-'))
const host = new Host(home)
let service, unsubscribe
try {
  // 可显式重开旧会话观察磁盘去重；不自动重放未完成任务。
  const record = process.env.HARNESS_WEBHOOK_SESSION
    ? host.open(process.env.HARNESS_WEBHOOK_SESSION, 'webhook-demo')
    : host.create({ cwd: process.cwd(), owner: 'webhook-demo', title: '061 Webhook演示' })
  unsubscribe = record.session.on(event => {
    if (event.type === 'message/assistant') console.log('Agent回复：', event.data.content)
    if (event.type === 'turn/end') console.log('Agent回合结束：', event.data.reason)
  })
  service = await startWebhook(record, { secret, port: Number(process.env.HARNESS_WEBHOOK_PORT ?? 0) })
  console.log('Webhook地址：', service.url)
  console.log('数据目录：', home)
  console.log('会话ID：', record.header.id)
  console.log('模型：OfflineModel；真实Host/Agent/Journal，不请求外部模型。Ctrl+C退出。')
  // 等待退出信号，正常退出后释放端口、Agent和日志锁。
  await new Promise(resolve => {
    const stop = () => { process.off('SIGINT', stop); process.off('SIGTERM', stop); resolve() }
    process.once('SIGINT', stop); process.once('SIGTERM', stop)
  })
} finally {
  try { if (service) await service.close() }
  finally { unsubscribe?.(); await host.close() }
}
