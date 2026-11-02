import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'

/** PKCE不把client secret放在桌面包里；账户后端必须明确配置。 */
export function loginAttempt({ authorizeURL, clientId, redirectURI }) {
  const verifier = randomBytes(32).toString('base64url'), state = randomBytes(24).toString('base64url')
  const url = new URL(authorizeURL)
  url.searchParams.set('response_type', 'code'); url.searchParams.set('client_id', clientId); url.searchParams.set('redirect_uri', redirectURI)
  url.searchParams.set('state', state); url.searchParams.set('code_challenge_method', 'S256'); url.searchParams.set('code_challenge', createHash('sha256').update(verifier).digest('base64url'))
  let consumed = false
  return { url: url.href,
    /** 回调只能消费一次，state和redirect路径都必须匹配。 */
    async exchange(callback, tokenURL, fetcher = fetch) {
      const result = new URL(callback), expected = new URL(redirectURI), actualState = result.searchParams.get('state') ?? ''
      if (consumed || result.origin !== expected.origin || result.pathname !== expected.pathname || actualState.length !== state.length || !timingSafeEqual(Buffer.from(actualState), Buffer.from(state))) throw Error('登录回调不合法或已消费')
      const code = result.searchParams.get('code'); if (!code) throw Error('回调缺少code')
      consumed = true
      const response = await fetcher(tokenURL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, redirect_uri: redirectURI, code, code_verifier: verifier }) })
      if (!response.ok) throw Error('登录换票失败：' + response.status)
      return await response.json()
    },
  }
}
