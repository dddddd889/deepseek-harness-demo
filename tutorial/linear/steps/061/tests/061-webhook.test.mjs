import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { webhook, webhookSignature } from '../src/webhook.mjs'
import { startWebhook } from '../src/webhook-http.mjs'
import { Host } from '../src/host.mjs'
import { Events } from '../src/events.mjs'

// 固定测试secret只用于本机测试，不使用真实外部账号凭据。
const secret = '061-local-test-secret'

/** 为原始字节生成自定义协议请求头，允许单项测试覆盖时间或投递身份。 */
function headers(body, delivery = 'delivery-1', timestamp = String(Date.now())) {
  return { 'content-type': 'application/json', 'x-webhook-delivery': delivery, 'x-webhook-timestamp': timestamp,
    'x-webhook-signature': webhookSignature(secret, body, { timestamp, delivery }) }
}

/** 每项HTTP测试使用真实临时Journal、Host和Agent，并在结束时关闭端口和删除目录。 */
async function fixture(run, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'webhook-061-')), host = new Host(root)
  let service
  try {
    const record = host.create({ cwd: root, owner: 'test' })
    service = await startWebhook(record, { secret, ...options })
    await run({ record, host, service, root })
  } finally {
    try { if (service) await service.close() }
    finally { try { await host.close() } finally { await rm(root, { recursive: true, force: true }) } }
  }
}

test('接收函数验证签名、时间和投递身份，重复请求只唤醒一次', () => {
  let pumps = 0
  const record = { session: new Events(), agent: { pump: () => pumps++ } }, body = Buffer.from('{"prompt":"review"}')
  const timestamp = String(Date.now()), delivery = 'delivery-1'
  const metadata = { timestamp, delivery, signature: webhookSignature(secret, body, { timestamp, delivery }) }
  assert.equal(webhook({ secret })(record, body, metadata).duplicate, false)
  assert.equal(webhook({ secret })(record, body, metadata).duplicate, true)
  assert.equal(pumps, 1)
  assert.throws(() => webhook({ secret })(record, Buffer.from('changed'), metadata), /签名/)
  assert.throws(() => webhook({ secret })(record, body, { ...metadata, delivery: 'delivery-2' }), /签名/)
  assert.throws(() => webhook({ secret })(record, body, { ...metadata, timestamp: String(Number(timestamp) - 1) }), /签名/)
})

test('真实HTTP投递触发Agent与离线模型，并在重开Host后保持去重', async () => {
  await fixture(async ({ record, host, service, root }) => {
    const body = Buffer.from('{"prompt":"来自HTTP的任务"}')
    const response = await fetch(service.url, { method: 'POST', headers: headers(body), body })
    assert.equal(response.status, 202)
    assert.deepEqual(await response.json(), { duplicate: false, inputId: 'webhook_delivery-1' })
    await record.agent.idle()
    assert.equal(record.session.read().findLast(event => event.type === 'message/assistant').data.content, '[离线演示] 来自HTTP的任务')
    assert.equal(record.session.read().findLast(event => event.type === 'turn/end').data.reason, 'completed')
    // 关闭并创建新的Host，从磁盘Journal恢复；不是只重建接收函数。
    await service.close()
    await host.close()
    const reopenedHost = new Host(root)
    let reopenedService
    try {
      const restored = reopenedHost.open(record.header.id, 'test')
      reopenedService = await startWebhook(restored, { secret })
      const duplicate = await fetch(reopenedService.url, { method: 'POST', headers: headers(body), body })
      assert.equal(duplicate.status, 200)
      assert.equal((await duplicate.json()).duplicate, true)
      await restored.agent.idle()
      assert.equal(restored.session.read().filter(event => event.type === 'inbox/add').length, 1)
      assert.equal(restored.session.read().filter(event => event.type === 'turn/start').length, 1)
    } finally {
      try { if (reopenedService) await reopenedService.close() } finally { await reopenedHost.close() }
    }
  })
})

test('同一进程并发重复投递只启动一回合，相同身份不同正文拒绝', async () => {
  await fixture(async ({ record, service }) => {
    const body = Buffer.from('{"prompt":"并发任务"}'), request = { method: 'POST', headers: headers(body), body }
    const replies = await Promise.all([fetch(service.url, request), fetch(service.url, request)])
    assert.deepEqual(replies.map(response => response.status).sort(), [200, 202])
    await record.agent.idle()
    assert.equal(record.session.read().filter(event => event.type === 'turn/start').length, 1)
    const changed = Buffer.from('{"prompt":"另一份正文"}')
    const conflict = await fetch(service.url, { method: 'POST', headers: headers(changed), body: changed })
    assert.equal(conflict.status, 409)
    assert.equal(record.session.read().filter(event => event.type === 'inbox/add').length, 1)
  })
})

test('错误签名、过期、无效JSON与空prompt都不入队', async () => {
  await fixture(async ({ record, service }) => {
    const body = Buffer.from('{"prompt":"review"}')
    const cases = [
      [body, { ...headers(body), 'x-webhook-signature': 'sha256=' + '0'.repeat(64) }, 401],
      [body, headers(body, 'expired', String(Date.now() - 600_000)), 401],
      [Buffer.from('{'), headers(Buffer.from('{')), 400],
      [Buffer.from('null'), headers(Buffer.from('null')), 400],
      [Buffer.from('{"prompt":"  "}'), headers(Buffer.from('{"prompt":"  "}')), 400],
    ]
    for (const [payload, metadata, status] of cases) {
      const response = await fetch(service.url, { method: 'POST', headers: metadata, body: payload })
      assert.equal(response.status, status)
    }
    assert.equal(record.session.read().length, 0)
  })
})

test('路由、方法、内容类型和正文大小受限，关闭后释放端口', async () => {
  await fixture(async ({ record, service }) => {
    assert.equal((await fetch(service.url.replace('/webhooks', '/missing'))).status, 404)
    assert.equal((await fetch(service.url)).status, 405)
    assert.equal((await fetch(service.url, { method: 'POST', body: 'text' })).status, 415)
    const body = Buffer.from('{"prompt":"超过限制的正文"}')
    assert.equal((await fetch(service.url, { method: 'POST', headers: headers(body), body })).status, 413)
    assert.equal(record.session.read().length, 0)
    await service.close()
    await assert.rejects(fetch(service.url, { signal: AbortSignal.timeout(1000) }))
  }, { maxBytes: 8 })
})

test('Agent关闭后拒绝新投递，持久化失败返回500且不报告接收成功', async () => {
  await fixture(async ({ record, service }) => {
    const body = Buffer.from('{"prompt":"review"}')
    record.session.persist = () => { throw Error('测试磁盘错误') }
    const failure = await fetch(service.url, { method: 'POST', headers: headers(body), body })
    assert.equal(failure.status, 500)
    assert.equal(record.session.read().length, 0)
    record.agent.closed = true
    assert.equal((await fetch(service.url, { method: 'POST', headers: headers(body), body })).status, 503)
  })
})
