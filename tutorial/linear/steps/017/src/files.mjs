import { createHash } from 'node:crypto'

/** Files API 的缓存身份由内容决定；并发上传合并，失败后允许重试。 */
export class ModelFiles {
  cache = new Map()
  inflight = new Map()
  constructor({ root, key, fetcher = fetch, now = () => Date.now() }) { this.root = root.replace(/\/$/, ''); this.key = key; this.fetcher = fetcher; this.now = now }
  /** 有效文件复用；refreshMargin 防止刚发请求就过期。 */
  async upload(bytes, mediaType, signal) {
    const digest = createHash('sha256').update(bytes).digest('hex'), cached = this.cache.get(digest)
    if (cached && cached.expiresAt > this.now() + 60_000) return cached.id
    if (this.inflight.has(digest)) return await this.inflight.get(digest)
    const operation = (async () => {
      signal.throwIfAborted()
      const body = new FormData(); body.set('file', new Blob([bytes], { type: mediaType }), digest)
      const response = await this.fetcher(this.root + '/files', { method: 'POST', signal, headers: { 'x-api-key': this.key, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'files-api-2025-04-14' }, body })
      if (!response.ok) throw Error('Files HTTP ' + response.status)
      const value = await response.json()
      if (typeof value.id !== 'string') throw Error('Files 缺少 id')
      this.cache.set(digest, { id: value.id, expiresAt: value.expires_at ? Date.parse(value.expires_at) : this.now() + 3_600_000 })
      return value.id
    })()
    this.inflight.set(digest, operation)
    try { return await operation } finally { this.inflight.delete(digest) }
  }
  /** 只删除自己缓存管理的文件，不批量清理账号里未知的上传。 */
  async remove(digest, signal) {
    const cached = this.cache.get(digest)
    if (!cached) return
    const response = await this.fetcher(this.root + '/files/' + encodeURIComponent(cached.id), { method: 'DELETE', signal, headers: { 'x-api-key': this.key, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'files-api-2025-04-14' } })
    if (!response.ok && response.status !== 404) throw Error('Files 删除失败')
    this.cache.delete(digest)
  }
}
