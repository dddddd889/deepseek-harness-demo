import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { Peer } from '../src/rpc.mjs'
import { remote } from '../src/remote.mjs'
import { Host } from '../src/host.mjs'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

test('原生控制器统一prompt/流/取消入口，资源权限在服务端验证', async () => {
  const root = mkdtempSync(join(tmpdir(), 'own-remote-')), host = new Host(root)
  const client = new Peer(message => void server.receive(message)), server = new Peer(message => void client.receive(message))
	// 这里相当于往Server上注册一个Agent，并且把它的所有方法都暴露给Peer，Peer只做传输和身份验证，不重写执行逻辑
  remote(server, host, 'alice')
  try {
    const header = await client.request('session.create', { cwd: root }), events = []
    client.on('notification', message => events.push(message.params))
    await client.request('session.watch', { id: header.id })
    await client.request('session.submit', { id: header.id, content: 'hi' })
    assert.equal((await client.request('session.wait', { id: header.id })).reason, 'completed')
    assert.ok(events.some(event => event.type === 'message/assistant'))
    const foreign = host.create({ cwd: root, owner: 'bob' })
    await assert.rejects(client.request('session.read', { id: foreign.header.id }), /权限/)
  } finally { client.close(); server.close(); await host.close(); rmSync(root, { recursive: true, force: true }) }
})
