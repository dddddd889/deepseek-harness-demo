import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { loginAttempt } from '../src/login.mjs'

test('真实PKCE编码、state校验和单次消费', async () => {
  const attempt = loginAttempt({ authorizeURL: 'https://accounts.example/authorize', clientId: 'desktop', redirectURI: 'http://127.0.0.1:1234/callback' })
  const state = new URL(attempt.url).searchParams.get('state')
  await assert.rejects(attempt.exchange('http://127.0.0.1:1234/callback?code=a&state=wrong', 'https://accounts.example/token'), /不合法/)
  let verifier
  const token = await attempt.exchange('http://127.0.0.1:1234/callback?code=a&state=' + state, 'https://accounts.example/token', async (url, request) => { verifier = request.body.get('code_verifier'); return Response.json({ access_token: 'test-token' }) })
  assert.equal(token.access_token, 'test-token'); assert.ok(verifier.length > 30)
  await assert.rejects(attempt.exchange('http://127.0.0.1:1234/callback?code=a&state=' + state, 'https://accounts.example/token'), /已消费/)
})
