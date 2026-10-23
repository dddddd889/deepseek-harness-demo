import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { Routes, RefreshToken } from '../src/routes.mjs'

test('请求前失败可重试，首片之后不重试；刷新并发合并', async () => {
  const routes = new Routes(); let attempts = 0, refreshes = 0
  routes.add('p', ['m'], { async *stream() { attempts++; if (attempts === 1) throw Error('network'); yield { kind: 'text', text: 'a' }; throw Error('broken') } })
  await assert.rejects(async () => { for await (const part of routes.stream({ config: { provider: 'p', model: 'm' }, signal: new AbortController().signal })) {} }, /broken/)
  assert.equal(attempts, 2)
  let value = { accessToken: 'old', expiresAt: 0 }
  const token = new RefreshToken(() => value, async () => { refreshes++; return { accessToken: 'new', expiresAt: Date.now() + 100_000 } }, next => { value = next })
  assert.deepEqual(await Promise.all([token.get(), token.get()]), ['new', 'new'])
  assert.equal(refreshes, 1)
})
