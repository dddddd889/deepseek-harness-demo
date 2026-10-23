import { createHmac, timingSafeEqual } from 'node:crypto'

/** 签名验证的是原始正文，不是JSON解析后重新序列化的字符串。 */
export function webhook({ secret, maxAge = 300_000 }) {
  if (!secret) throw Error('Webhook必须配置secret')
  return (record, body, { signature, timestamp, delivery }) => {
    if (!Number.isFinite(Number(timestamp)) || !delivery || !/^[a-zA-Z0-9_-]{1,100}$/.test(delivery) || Math.abs(Date.now() - Number(timestamp)) > maxAge) throw Error('Webhook身份或时间失效')
    const expected = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex'), actual = signature ?? ''
    if (actual.length !== expected.length || !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) throw Error('Webhook签名错误')
    const identity = 'webhook_' + delivery
    if (record.session.read().some(event => event.type === 'inbox/add' && event.data.id === identity)) return { duplicate: true, inputId: identity }
    const value = JSON.parse(body.toString())
    if (typeof value.prompt !== 'string') throw Error('Webhook缺少prompt')
    // 同一日志里的接收身份就是去重凭据，避免两个存储间的崩溃空隙。
    record.session.append('inbox/add', { id: identity, content: value.prompt, destination: 'turn', delivery })
    record.agent.pump()
    return { duplicate: false, inputId: identity }
  }
}
