import { createServer } from 'node:http'
import { webhook } from './webhook.mjs'

/** 启动独立的本机Webhook入口；固定绑定一个已有会话，不接受请求指定owner或工作区。 */
export async function startWebhook(record, { secret, port = 0, maxBytes = 64 * 1024 } = {}) {
  const receive = webhook({ secret })
  // 响应只报告接收结果，模型回复从Session事件读取，不在HTTP回执中假装完成。
  const server = createServer(async (request, response) => {
    const reply = (status, value) => {
      response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify(value))
    }
    try {
      if (request.url !== '/webhooks') { request.resume(); reply(404, { error: '未找到路由' }); return }
      if (request.method !== 'POST') { request.resume(); response.setHeader('allow', 'POST'); reply(405, { error: '只接受POST' }); return }
      if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
        request.resume(); reply(415, { error: '需要application/json' }); return
      }
      // 保留原始字节验签，并限制正文大小；不能先JSON.parse再序列化后验证。
      const chunks = []; let size = 0
      for await (const chunk of request) {
        size += chunk.length
        if (size > maxBytes) { request.resume(); reply(413, { error: 'Webhook正文过大' }); return }
        chunks.push(chunk)
      }
      const result = receive(record, Buffer.concat(chunks), {
        signature: request.headers['x-webhook-signature'],
        timestamp: request.headers['x-webhook-timestamp'],
        delivery: request.headers['x-webhook-delivery'],
      })
      reply(result.duplicate ? 200 : 202, result)
    } catch (error) {
      // 只暴露协议校验错误；磁盘或内部异常不把本机路径等细节回传。
      if (!response.headersSent && !response.destroyed) reply(error.statusCode ?? 500, { error: error.statusCode ? error.message : 'Webhook内部错误' })
    }
  })
  server.requestTimeout = 10_000
  server.headersTimeout = 5_000
  // 这一行才真正监听TCP端口；等待成功后，调用方才能打印地址或发请求。
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => { server.removeListener('error', reject); resolve() })
  })
  let closing
  return {
    url: 'http://127.0.0.1:' + server.address().port + '/webhooks',
    // 停服务时关闭连接；Host的Agent和日志由拥有它的调用方另行关闭。
    close: () => closing ??= new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve())
      server.closeAllConnections()
    }),
  }
}
