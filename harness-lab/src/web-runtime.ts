export interface WebSearchSource {
  readonly url: string
  readonly title?: string
  readonly snippet?: string
}

export interface WebSearchResult {
  readonly content?: string
  readonly sources: readonly WebSearchSource[]
  readonly truncated: boolean
}

export interface WebSearchProvider {
  readonly id: string
  available(): boolean
  search(query: string, maxResults: number, signal?: AbortSignal): Promise<WebSearchResult>
}

export interface WebFetchResult {
  readonly url: string
  readonly statusCode: number
  readonly content: string
  readonly kind: 'html' | 'text'
  readonly truncated: boolean
}

export interface WebFetchProvider {
  readonly id: string
  available(): boolean
  fetch(url: string, signal?: AbortSignal): Promise<WebFetchResult>
}

export class WebRuntimeError extends Error {
  readonly code: string
  constructor(message: string, code: string) {
    super(message)
    this.code = code
  }
}

/** 网页接口边界在执行时选择提供方，绝不依赖注册顺序。 */
export class WebRuntime {
  readonly #search = new Map<string, WebSearchProvider>()
  readonly #fetch = new Map<string, WebFetchProvider>()
  readonly #searchProvider: string | undefined
  readonly #fetchProvider: string | undefined

  constructor(config: { readonly searchProvider?: string; readonly fetchProvider?: string } = {}) {
    this.#searchProvider = config.searchProvider
    this.#fetchProvider = config.fetchProvider
  }

  registerSearch(provider: WebSearchProvider): () => void {
    return this.#register(this.#search, provider)
  }

  registerFetch(provider: WebFetchProvider): () => void {
    return this.#register(this.#fetch, provider)
  }

  async search(query: string, maxResults: number, signal?: AbortSignal): Promise<WebSearchResult> {
    const result = await this.#resolve(this.#search, this.#searchProvider).search(query, maxResults, signal)
    return result.sources.length <= maxResults
      ? result
      : { ...result, sources: result.sources.slice(0, maxResults), truncated: true }
  }

  async fetch(url: string, signal?: AbortSignal): Promise<WebFetchResult> {
    return this.#resolve(this.#fetch, this.#fetchProvider).fetch(url, signal)
  }

  #register<P extends { readonly id: string }>(store: Map<string, P>, provider: P): () => void {
    if (store.has(provider.id)) throw new WebRuntimeError(`网页提供方重复：${provider.id}`, 'WEB_DUPLICATE_PROVIDER')
    store.set(provider.id, provider)
    return () => store.delete(provider.id)
  }

  #resolve<P extends { readonly id: string; available(): boolean }>(store: Map<string, P>, configured?: string): P {
    if (configured !== undefined) {
      const provider = store.get(configured)
      if (provider === undefined) throw new WebRuntimeError(`配置的提供方未注册：${configured}`, 'WEB_PROVIDER_CONFIGURED_MISSING')
      if (!provider.available()) throw new WebRuntimeError(`配置的提供方不可用：${configured}`, 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE')
      return provider
    }
    const available = [...store.values()].filter(provider => provider.available())
    if (available.length === 0) throw new WebRuntimeError('没有可用的网页提供方', 'WEB_PROVIDER_UNAVAILABLE')
    if (available.length > 1) throw new WebRuntimeError('存在多个网页提供方，必须显式选择', 'WEB_PROVIDER_AMBIGUOUS')
    return available[0] as P
  }
}
