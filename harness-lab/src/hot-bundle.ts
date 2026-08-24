import { HarnessBundle } from './bundle.ts'
import type { Plugin } from './context.ts'

/** 以整套 Bundle 为事务边界热替换；候选挂载失败时旧代仍继续服务。 */
export class HotBundle {
  #current: HarnessBundle | undefined
  #generation = 0

  get generation(): number { return this.#generation }

  use<T>(key: string): T {
    if (!this.#current) throw new Error('Bundle 尚未加载')
    return this.#current.context.get<T>(key)
  }

  async reload(plugins: readonly Plugin[]): Promise<number> {
    const candidate = new HarnessBundle()
    await candidate.mount(plugins)
    const previous = this.#current
    this.#current = candidate
    this.#generation += 1
    await previous?.dispose()
    return this.#generation
  }

  async dispose(): Promise<void> {
    const current = this.#current
    this.#current = undefined
    await current?.dispose()
  }
}
