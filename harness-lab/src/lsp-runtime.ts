export type LspOperation = 'goToDefinition' | 'findReferences' | 'goToImplementation' | 'hover'
export interface LspQuery {
  readonly operation: LspOperation
  readonly filePath: string
  readonly line: number
  readonly character: number
  readonly workspaceRoot: string
}
export type LspResult =
  | { readonly kind: 'locations'; readonly locations: readonly { readonly uri: string; readonly line: number; readonly character: number }[] }
  | { readonly kind: 'hover'; readonly contents: string | null }
export interface LspProvider {
  readonly id: string
  readonly extensionToLanguage: Readonly<Record<string, string>>
  query(request: LspQuery & { readonly languageId: string }, signal?: AbortSignal): Promise<LspResult>
}

export class LspRuntimeError extends Error {
  readonly code: string
  constructor(message: string, code: string) { super(message); this.code = code }
}

/** 取最终扩展名；foo.d.ts 路由为 .ts，dotfile 不被误判。 */
export function finalExtension(path: string): string {
  const base = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
  const dot = base.lastIndexOf('.')
  return dot <= 0 ? '' : base.slice(dot).toLowerCase()
}

/** LSP seam 原子保留 provider id 与全部扩展名。 */
export class LspRuntime {
  readonly #ids = new Set<string>()
  readonly #routes = new Map<string, { readonly provider: LspProvider; readonly languageId: string }>()

  register(provider: LspProvider): () => void {
    if (provider.id.trim() === '' || this.#ids.has(provider.id)) throw new LspRuntimeError('LSP provider id 无效或冲突', 'LSP_CONFLICT')
    const pending = new Map<string, string>()
    for (const [raw, languageId] of Object.entries(provider.extensionToLanguage)) {
      const extension = (raw.startsWith('.') ? raw : `.${raw}`).toLowerCase()
      if (!/^\.[^./\\]+$/.test(extension) || languageId.trim() === '' || pending.has(extension)) {
        throw new LspRuntimeError(`LSP 扩展映射无效：${raw}`, 'LSP_INVALID_PROVIDER')
      }
      if (this.#routes.has(extension)) throw new LspRuntimeError(`LSP 扩展冲突：${extension}`, 'LSP_CONFLICT')
      pending.set(extension, languageId)
    }
    if (pending.size === 0) throw new LspRuntimeError('LSP provider 没有扩展映射', 'LSP_INVALID_PROVIDER')
    this.#ids.add(provider.id)
    for (const [extension, languageId] of pending) this.#routes.set(extension, { provider, languageId })
    return () => {
      this.#ids.delete(provider.id)
      for (const extension of pending.keys()) this.#routes.delete(extension)
    }
  }

  async query(request: LspQuery, signal?: AbortSignal): Promise<LspResult> {
    const route = this.#routes.get(finalExtension(request.filePath))
    if (route === undefined) throw new LspRuntimeError(`没有 LSP 处理 ${request.filePath}`, 'LSP_UNAVAILABLE')
    return route.provider.query({ ...request, languageId: route.languageId }, signal)
  }
}
