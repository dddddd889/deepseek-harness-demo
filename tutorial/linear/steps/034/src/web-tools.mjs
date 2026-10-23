import { lookup } from 'node:dns/promises'

/** 网络策略先检查目的地，再处理每一次重定向；Key不进入模型参数。 */
export class Web {
  constructor({ allowLocal = false, searchURL, searchKey, fetcher = fetch } = {}) { this.allowLocal = allowLocal; this.searchURL = searchURL; this.searchKey = searchKey; this.fetcher = fetcher }
  async check(value) {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Error('URL不合法')
    if (!this.allowLocal) {
      const addresses = await lookup(url.hostname, { all: true })
      if (addresses.some(({ address }) => /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|::1$|fc|fd|fe80)/i.test(address))) throw Error('私网目的地被拒绝')
    }
    return url
  }
  /** 固定最大正文、超时与跳转次数。DNS绑定的强隔离需要网络沙箱补强。 */
  async fetchText(value, signal) {
    for (let redirects = 0; redirects < 5; redirects++) {
      const url = await this.check(value)
      const response = await this.fetcher(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]), redirect: 'manual' })
      if (response.status >= 300 && response.status < 400) { value = new URL(response.headers.get('location'), url).href; continue }
      if (!response.ok) throw Error('网页HTTP ' + response.status)
      let bytes = 0, text = '', decoder = new TextDecoder()
      for await (const chunk of response.body) { bytes += chunk.length; if (bytes > 1024 * 1024) throw Error('网页正文超限'); text += decoder.decode(chunk, { stream: true }) }
      text += decoder.decode()
      // 仅生成可显示文本，不把抓取的HTML注入页面；复杂网页交给浏览器提供方。
      return { url: url.href, text: text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ') }
    }
    throw Error('网页跳转过多')
  }
  /** 搜索服务返回来源链接；搜索结果中的指令不获得工具执行权限。 */
  async search(query, signal) {
    if (!this.searchURL) throw Error('尚未配置搜索提供方')
    const url = await this.check(this.searchURL)
    const response = await this.fetcher(url, { method: 'POST', signal, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + this.searchKey }, body: JSON.stringify({ query }) })
    if (!response.ok) throw Error('搜索HTTP ' + response.status)
    return await response.json()
  }
}
