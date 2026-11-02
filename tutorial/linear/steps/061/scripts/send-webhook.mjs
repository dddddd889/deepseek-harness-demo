import { randomUUID } from 'node:crypto'
import { webhookSignature } from '../src/webhook.mjs'

// 参数：接收地址、任务正文、可选投递ID；相同ID用于验证重复投递。
const [address, prompt = '请处理这条Webhook任务', delivery = randomUUID()] = process.argv.slice(2)
const secret = process.env.HARNESS_WEBHOOK_SECRET
if (!secret || !address) throw Error('设置HARNESS_WEBHOOK_SECRET后执行：bun scripts/send-webhook.mjs URL "任务" [delivery-id]')
const url = new URL(address)
if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/webhooks') throw Error('本示例仅向本机127.0.0.1的/webhooks发送请求')
// 对即将发送的原始字节签名，不在签名后改变JSON空白或字段顺序。
const body = Buffer.from(JSON.stringify({ prompt })), timestamp = String(Date.now())
const signature = webhookSignature(secret, body, { timestamp, delivery })
const response = await fetch(url, {
  method: 'POST', signal: AbortSignal.timeout(5_000), body,
  headers: { 'content-type': 'application/json', 'x-webhook-timestamp': timestamp, 'x-webhook-delivery': delivery, 'x-webhook-signature': signature },
})
console.log('HTTP', response.status, await response.text())
if (!response.ok) process.exitCode = 1
