import { createHmac, createHash, timingSafeEqual } from 'node:crypto'

/** 自定义签名同时绑定时间、投递身份和原始正文；与GitHub协议不同。 */
export function webhookSignature(secret, body, { timestamp, delivery }) {
  return 'sha256=' + createHmac('sha256', secret).update(String(timestamp) + '\n' + delivery + '\n').update(body).digest('hex')
}

/** 给接入层提供明确状态码；持久化等未知错误仍由HTTP层报告500。 */
function reject(statusCode, message) { throw Object.assign(Error(message), { statusCode }) }

/** 验签与入队保持同步，避免同一进程的并发请求穿过检查后重复追加。 */
export function webhook({ secret, maxAge = 300_000 }) {
  if (!secret) throw Error('Webhook必须配置secret')
  return (record, body, { signature, timestamp, delivery }) => {
    // 时间使用毫秒字符串，投递身份限制为ASCII；两者都包含在HMAC中。
    if (!/^\d{13}$/.test(String(timestamp)) || !/^[a-zA-Z0-9_-]{1,100}$/.test(delivery ?? '') || Math.abs(Date.now() - Number(timestamp)) > maxAge) reject(401, 'Webhook身份或时间失效')
    const expected = webhookSignature(secret, body, { timestamp, delivery })
    // 固定ASCII格式后再比较字节，避免等字符数却不等字节数造成异常。
    if (!/^sha256=[a-f0-9]{64}$/.test(signature ?? '') || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) reject(401, 'Webhook签名错误')
    const identity = 'webhook_' + delivery, digest = createHash('sha256').update(body).digest('hex')
    const previous = record.session.read().find(event => event.type === 'inbox/add' && event.data.id === identity)
    if (previous) {
      if (previous.data.webhookDigest !== digest) reject(409, '相同投递身份的正文不同')
      return { duplicate: true, inputId: identity }
    }
    let value
    try { value = JSON.parse(body.toString()) } catch { reject(400, 'Webhook正文不是合法JSON') }
    if (!value || typeof value.prompt !== 'string' || !value.prompt.trim()) reject(400, 'Webhook缺少非空prompt')
    if (record.agent.closed) reject(503, 'Agent已关闭')
    // 同一条持久日志既记录接收身份又保存任务；摘要用于识别身份复用但正文不同的请求。
    record.session.append('inbox/add', { id: identity, content: value.prompt, destination: 'turn', delivery, webhookDigest: digest })
    // 唤醒真实Agent领取任务，HTTP不等待模型执行结束；入队不等于执行成功。
    record.agent.pump()
    return { duplicate: false, inputId: identity }
  }
}
