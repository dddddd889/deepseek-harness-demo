import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'

/** PKCE不把client secret放在桌面包里；账户后端必须明确配置。 */
export function loginAttempt({ authorizeURL, clientId, redirectURI }) {
  // verifier是本次登录的随机秘密，只在当前闭包保留，最后换token时提交；state独立生成，用于匹配回调。
  const verifier = randomBytes(32).toString('base64url'), state = randomBytes(24).toString('base64url')
  const url = new URL(authorizeURL)
  // 选择OAuth授权码流程：authorize返回的是一次性code，不是直接返回access_token。
  url.searchParams.set('response_type', 'code'); url.searchParams.set('client_id', clientId); url.searchParams.set('redirect_uri', redirectURI)
  // challenge = BASE64URL(SHA256(verifier))；授权URL只带摘要和state，不带原始verifier。
  // S256告诉授权服务器用SHA-256验证，服务器需要把challenge与后续签发的code绑定。
  url.searchParams.set('state', state); url.searchParams.set('code_challenge_method', 'S256'); url.searchParams.set('code_challenge', createHash('sha256').update(verifier).digest('base64url'))
  // 当前尝试是否已发起过兑换：这是本地一次性保护，不等于授权服务器已确认登录成功。
  let consumed = false
  return { url: url.href,
    /** 回调只能消费一次，state和redirect路径都必须匹配。 */
    async exchange(callback, tokenURL, fetcher = fetch) {
      // callback由回调接入层提供；先校验origin、路径和state，不能收到code就立即兑换。
      const result = new URL(callback), expected = new URL(redirectURI), actualState = result.searchParams.get('state') ?? ''
      if (consumed || result.origin !== expected.origin || result.pathname !== expected.pathname || actualState.length !== state.length || !timingSafeEqual(Buffer.from(actualState), Buffer.from(state))) throw Error('登录回调不合法或已消费')
      // code由授权服务器在用户授权后签发；它不是verifier、state，也不是最终token。
      const code = result.searchParams.get('code'); if (!code) throw Error('回调缺少code')
      // 发网络请求之前标记已消费；即使随后网络失败，也要新建登录尝试，不能重放当前回调。
      consumed = true
      // 将code和原始verifier交给token端点；服务器重新计算摘要并与保存的challenge比较。
      // 此函数是客户端，不在本地冒充授权服务器完成PKCE验证。
      const response = await fetcher(tokenURL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, redirect_uri: redirectURI, code, code_verifier: verifier }) })
      if (!response.ok) throw Error('登录换票失败：' + response.status)
      // 返回服务器的token响应；本章不负责把凭据落盘，也没有自动打开浏览器或接收系统回调。
      return await response.json()
    },
  }
}
