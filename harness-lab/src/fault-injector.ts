export type FaultAction = { readonly kind: 'throw'; readonly message: string } | { readonly kind: 'delay'; readonly millis: number }

/** 可重复的第 N 次故障注入器，测试恢复、超时和隔离边界。 */
export class FaultInjector {
  readonly #rules = new Map<string, { at: number; action: FaultAction; seen: number }>()

  configure(point: string, at: number, action: FaultAction): void {
    if (!Number.isInteger(at) || at < 1) throw new Error('故障序号必须为正整数')
    this.#rules.set(point, { at, action, seen: 0 })
  }

  async hit(point: string, signal?: AbortSignal): Promise<void> {
    const rule = this.#rules.get(point)
    if (!rule || ++rule.seen !== rule.at) return
    if (rule.action.kind === 'throw') throw new Error(rule.action.message)
    const millis = rule.action.millis
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, millis)
      signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason) }, { once: true })
    })
  }
}
