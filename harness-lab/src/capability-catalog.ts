export type CapabilityKind = 'skill' | 'tool' | 'web-search' | 'web-fetch' | 'lsp' | 'attachment'

export interface CapabilitySummary {
  readonly kind: CapabilityKind
  readonly id: string
  readonly provider: string
  readonly description: string
}

/** 统一目录只负责发现和所有权；执行仍由各自的深接口负责。 */
export class CapabilityCatalog {
  readonly #entries = new Map<string, CapabilitySummary>()

  register(summary: CapabilitySummary): () => void {
    const key = `${summary.kind}:${summary.id}`
    if (this.#entries.has(key)) throw new Error(`能力已存在：${key}`)
    this.#entries.set(key, Object.freeze({ ...summary }))
    return () => this.#entries.delete(key)
  }

  list(kind?: CapabilityKind): readonly CapabilitySummary[] {
    return [...this.#entries.values()]
      .filter(entry => kind === undefined || entry.kind === kind)
      .sort((left, right) => `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`))
  }
}
