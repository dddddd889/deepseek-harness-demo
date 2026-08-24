import { snapshotJson } from './json.ts'
import type { SessionEvent, SessionEventMap, SessionEventType, SurfaceOp } from './domain.ts'

export interface AppendOptions {
  readonly ignorable?: true
  readonly surfaceOp?: SurfaceOp
  readonly sourceEventSeqs?: readonly number[]
}

/** 最小只追加会话；事件数组是后续持久化和投影的唯一事实源。 */
export class Session {
  readonly #events: SessionEvent[] = []
  readonly #listeners = new Set<(event: SessionEvent) => void>()

  constructor(seed: readonly SessionEvent[] = []) {
    for (let index = 0; index < seed.length; index += 1) {
      const event = seed[index]
      if (event?.seq !== index) throw new Error(`恢复事件 seq 不连续：期望 ${index}，得到 ${event?.seq}`)
      this.#events.push(snapshotJson(event))
    }
  }

  get events(): readonly SessionEvent[] {
    return this.#events
  }

  /** 订阅提交后的事件；持久化层用它建立后台写入队列。 */
  onAppend(listener: (event: SessionEvent) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  /** 追加一条事件；序号和时间由会话统一生成。 */
  append<T extends SessionEventType>(
    type: T,
    data: SessionEventMap[T],
    time = Date.now(),
    options: AppendOptions = {},
  ): SessionEvent<T> {
    const event = snapshotJson({
      type,
      seq: this.#events.length,
      time,
      data,
      ...options,
    }) as SessionEvent<T>
    // 泛型变体在此已经由 事件类型与数据的同一泛型参数 绑定；数组保存的是其联合上界。
    this.#events.push(event as unknown as SessionEvent)
    for (const listener of this.#listeners) listener(event as unknown as SessionEvent)
    return event
  }
}
