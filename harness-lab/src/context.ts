export type Disposer = () => void | Promise<void>
export type EffectBody = () => void | Disposer | Promise<void | Disposer>
export type EventListener = (...args: readonly unknown[]) => void

export interface Plugin {
  readonly name: string
  apply(context: PluginContext): void | Promise<void>
}

/** 一个插件自己的生命周期作用域；插件只能释放自己登记的资源。 */
export class PluginContext {
  readonly #root: HarnessContext
  readonly #pluginName: string
  readonly #disposers: Disposer[] = []
  #disposed = false

  constructor(root: HarnessContext, pluginName: string) {
    this.#root = root
    this.#pluginName = pluginName
  }

  /** 注册一个可逆副作用，并保存对应的清理函数。 */
  async effect(body: EffectBody): Promise<void> {
    this.#assertActive()
    const disposer = await body()
    if (typeof disposer === 'function') this.#disposers.push(disposer)
  }

  /** 发布服务；插件卸载时只撤销自己发布的那个实例。 */
  async provide<T>(key: string, value: T): Promise<void> {
    await this.effect(() => this.#root.provide(this.#pluginName, key, value))
  }

  /** 订阅事件；底层订阅会自动转成当前插件的 Effect。 */
  async on(event: string, listener: EventListener): Promise<void> {
    await this.effect(() => this.#root.subscribe(event, listener))
  }

  /** 获取已发布服务；调用方通过稳定 key，而不是具体实现类耦合。 */
  get<T>(key: string): T {
    this.#assertActive()
    return this.#root.get<T>(key)
  }

  /** 逆序释放资源，保证后注册的依赖先被清理。 */
  async dispose(): Promise<void> {
    if (this.#disposed) return
    this.#disposed = true
    const errors: unknown[] = []
    for (const disposer of this.#disposers.reverse()) {
      try {
        await disposer()
      } catch (error) {
        errors.push(error)
      }
    }
    this.#disposers.length = 0
    if (errors.length > 0) throw new AggregateError(errors, `插件 ${this.#pluginName} 清理失败`)
  }

  /** 防止插件卸载后继续向运行时注册新资源。 */
  #assertActive(): void {
    if (this.#disposed) throw new Error(`插件 ${this.#pluginName} 已卸载`)
  }
}

/** 最小 Harness 容器：管理服务、事件和插件生命周期。 */
export class HarnessContext {
  readonly #services = new Map<string, { owner: string; value: unknown }>()
  readonly #listeners = new Map<string, Set<EventListener>>()
  readonly #plugins = new Map<string, PluginContext>()

  /** 挂载插件；启动失败时回滚已经注册的全部 Effect。 */
  async mount(plugin: Plugin): Promise<Disposer> {
    if (this.#plugins.has(plugin.name)) throw new Error(`插件 ${plugin.name} 已挂载`)
    const pluginContext = new PluginContext(this, plugin.name)
    this.#plugins.set(plugin.name, pluginContext)
    try {
      await plugin.apply(pluginContext)
    } catch (error) {
      this.#plugins.delete(plugin.name)
      await pluginContext.dispose()
      throw error
    }
    return async () => {
      if (this.#plugins.get(plugin.name) !== pluginContext) return
      this.#plugins.delete(plugin.name)
      await pluginContext.dispose()
    }
  }

  /** 按注册顺序广播同步事件。 */
  emit(event: string, ...args: readonly unknown[]): void {
    const listeners = [...(this.#listeners.get(event) ?? [])]
    for (const listener of listeners) listener(...args)
  }

  /** 获取服务；缺失时立即失败，避免把依赖错误拖到业务深处。 */
  get<T>(key: string): T {
    const entry = this.#services.get(key)
    if (entry === undefined) throw new Error(`服务 ${key} 不可用`)
    return entry.value as T
  }

  /** 输出只读诊断快照，供测试和调试器检查。 */
  inspect(): { services: readonly string[]; plugins: readonly string[]; listeners: Readonly<Record<string, number>> } {
    return {
      services: [...this.#services.keys()].sort(),
      plugins: [...this.#plugins.keys()].sort(),
      listeners: Object.fromEntries(
        [...this.#listeners.entries()].map(([event, listeners]) => [event, listeners.size]),
      ),
    }
  }

  /** 内部发布服务，并返回带实例身份检查的撤销函数。 */
  provide<T>(owner: string, key: string, value: T): Disposer {
    if (this.#services.has(key)) {
      const existing = this.#services.get(key)
      throw new Error(`服务 ${key} 已由插件 ${existing?.owner} 发布`)
    }
    const entry = { owner, value }
    this.#services.set(key, entry)
    return () => {
      if (this.#services.get(key) === entry) this.#services.delete(key)
    }
  }

  /** 内部登记监听器，并返回幂等撤销函数。 */
  subscribe(event: string, listener: EventListener): Disposer {
    const listeners = this.#listeners.get(event) ?? new Set<EventListener>()
    this.#listeners.set(event, listeners)
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) this.#listeners.delete(event)
    }
  }
}

