import { setTimeout as delay } from 'node:timers/promises'

/** 模型提供方注册与目录；Loop 始终只见 stream 契约。 */
export class Routes {
  providers = new Map()
  /** 注册目录和实例，未知路由必须失败，不偷换默认模型。 */
  add(name, models, provider) { if (this.providers.has(name)) throw Error('重复提供方'); this.providers.set(name, { models, provider }); return () => this.providers.delete(name) }
  /** 配置已经在 turn 边界冻结；重试前仍使用同一份快照。 */
  async *stream(request) {
    const route = this.providers.get(request.config.provider)
    if (!route || !route.models.includes(request.config.model)) throw Error('未知模型路由')
    for (let attempt = 0; ; attempt++) {
      let published = false
      try {
        for await (const part of route.provider.stream(request)) { published = true; yield part }
        return
      } catch (error) {
        // 输出开始后不盲重试，避免重复文字/工具副作用。
        if (published || request.signal.aborted || attempt >= 1) throw error
        await delay(10 * (attempt + 1), undefined, { signal: request.signal })
      }
    }
  }
}

/** OAuth 刷新采用 single-flight，多个请求不会同时改写 refresh token。 */
export class RefreshToken {
  pending = undefined
  constructor(read, refresh, write) { this.read = read; this.refresh = refresh; this.write = write }
  async get() {
    const value = await this.read()
    if (value.expiresAt > Date.now() + 60_000) return value.accessToken
    this.pending ??= Promise.resolve().then(async () => { const next = await this.refresh(value); await this.write(next); return next.accessToken }).finally(() => { this.pending = undefined })
    return await this.pending
  }
}