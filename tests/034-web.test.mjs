import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { Web } from '../src/web-tools.mjs'

test('真实HTTP跳转、文本提取与私网默认拒绝', async () => {
  const server = createServer((request, response) => {
    if (request.url === '/go') { response.writeHead(302, { location: '/page' }); response.end() }
    else response.end('<script>bad()</script><p>中文正文</p>')
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const url = 'http://127.0.0.1:' + server.address().port + '/go', signal = new AbortController().signal
  try {
    await assert.rejects(new Web().fetchText(url, signal), /私网/)
    const result = await new Web({ allowLocal: true }).fetchText(url, signal)
    assert.match(result.text, /中文正文/); assert.ok(!result.text.includes('bad'))
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
})