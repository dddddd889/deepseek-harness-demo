import { assertNever, createMessage } from './domain.ts'
import type {
  ContentBlock,
  ContentBlockType,
  FinishReason,
  Message,
  StreamChunk,
  TokenUsage,
  ToolSchema,
} from './domain.ts'

export interface GenerateOptions {
  readonly provider: string
  readonly model: string
  readonly messages: readonly Message[]
  readonly system?: string
  readonly tools?: readonly ToolSchema[]
  readonly temperature?: number
  readonly maxTokens?: number
}

export interface LlmProvider {
  /** Provider 只负责翻译线上的流；异常与取消由 LlmRuntime 统一归一化。 */
  stream(options: GenerateOptions, signal: AbortSignal): AsyncIterable<StreamChunk>
}

/** Provider 路由与错误边界；消费者永远看到一个终止 finish，而不是裸异常。 */
export class LlmRuntime {
  readonly #providers = new Map<string, LlmProvider>()

  register(id: string, provider: LlmProvider): () => void {
    if (this.#providers.has(id)) throw new Error(`LLM Provider 已存在：${id}`)
    this.#providers.set(id, provider)
    return () => this.#providers.delete(id)
  }

  async *stream(options: GenerateOptions, signal: AbortSignal): AsyncGenerator<StreamChunk> {
    const provider = this.#providers.get(options.provider)
    if (!provider) {
      yield failureFinish('UNKNOWN_PROVIDER', `找不到 LLM Provider：${options.provider}`)
      return
    }

    try {
      for await (const chunk of provider.stream(options, signal)) {
        if (signal.aborted) {
          yield abortedFinish(signal.reason)
          return
        }
        yield chunk
        if (chunk.type === 'finish') return
      }
      yield { type: 'finish', reason: { kind: 'stop' } }
    } catch (error) {
      if (signal.aborted) yield abortedFinish(signal.reason)
      else yield failureFinish('PROVIDER_ERROR', error instanceof Error ? error.message : String(error))
    }
  }
}

/** 可脚本化 Provider：测试和调试无需网络，也能精确控制每个 chunk。 */
export class ScriptedLlmProvider implements LlmProvider {
  readonly #chunks: readonly StreamChunk[]
  readonly #delayMs: number

  constructor(chunks: readonly StreamChunk[], delayMs = 0) {
    this.#chunks = chunks
    this.#delayMs = delayMs
  }

  async *stream(_options: GenerateOptions, signal: AbortSignal): AsyncGenerator<StreamChunk> {
    for (const chunk of this.#chunks) {
      signal.throwIfAborted()
      if (this.#delayMs > 0) await abortableDelay(this.#delayMs, signal)
      yield chunk
    }
  }
}

interface PartialBlock {
  readonly blockType: ContentBlockType
  text: string
  callId?: string
  name?: string
  arguments: string
  block?: ContentBlock
}

/** 将可交错的 delta 流确定性组装成最终 assistant message。 */
export class BlockAssembler {
  readonly #partials = new Map<number, PartialBlock>()
  readonly #order: number[] = []
  usage: TokenUsage | undefined
  finish: FinishReason = { kind: 'stop' }

  push(chunk: StreamChunk): void {
    switch (chunk.type) {
      case 'block-start':
        this.ensure(chunk.index, chunk.blockType)
        return
      case 'text-delta':
      case 'reasoning-delta': {
        const partial = this.ensure(chunk.index, chunk.type === 'text-delta' ? 'text' : 'reasoning')
        if (!partial.block) partial.text += chunk.text
        return
      }
      case 'tool-call-delta': {
        const partial = this.ensure(chunk.index, 'tool-call')
        if (partial.block) return
        partial.callId = chunk.id
        if (chunk.name !== undefined) partial.name = chunk.name
        partial.arguments += chunk.argumentsDelta
        return
      }
      case 'block-end':
        if (!this.ensure(chunk.index, chunk.block.type).block) this.ensure(chunk.index, chunk.block.type).block = chunk.block
        return
      case 'usage':
        this.usage = chunk.usage
        return
      case 'finish':
        this.finish = chunk.reason
        return
      default:
        return assertNever(chunk)
    }
  }

  /** 只允许首次出现的 index 决定顺序，避免交错 delta 改写块顺序。 */
  private ensure(index: number, blockType: ContentBlockType): PartialBlock {
    let partial = this.#partials.get(index)
    if (!partial) {
      partial = { blockType, text: '', arguments: '' }
      this.#partials.set(index, partial)
      this.#order.push(index)
    }
    return partial
  }

  blocks(): readonly ContentBlock[] {
    const blocks = this.#order.map((index) => {
      const partial = this.#partials.get(index)
      if (!partial) throw new Error(`组装器状态损坏：缺少 block ${index}`)
      if (partial.block) return partial.block
      if (partial.blockType === 'text') return { type: 'text', text: partial.text } as const
      if (partial.blockType === 'reasoning') return { type: 'reasoning', text: partial.text } as const
      if (partial.blockType === 'tool-call') {
        return { type: 'tool-call', id: partial.callId ?? `call-${index}`, name: partial.name ?? '', arguments: partial.arguments } as const
      }
      throw new Error(`无法组装 block 类型：${partial.blockType}`)
    })
    return this.finish.kind === 'max-tokens' ? blocks.filter(block => block.type !== 'tool-call') : blocks
  }

  message(provider: string, model: string): Message {
    return createMessage({ role: 'assistant', content: this.blocks(), source: { kind: 'model', provider, model } })
  }
}

/** 将计时器与 AbortSignal 绑定，取消后不遗留后台定时任务。 */
function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms)
    function done(): void {
      signal.removeEventListener('abort', cancelled)
      resolve()
    }
    function cancelled(): void {
      clearTimeout(timer)
      reject(signal.reason)
    }
    signal.addEventListener('abort', cancelled, { once: true })
  })
}

/** 构造 Provider 异常对应的协议终止帧。 */
function failureFinish(code: string, message: string): StreamChunk {
  return { type: 'finish', reason: { kind: 'error', failure: { code, message } } }
}

/** 构造取消对应的协议终止帧。 */
function abortedFinish(reason: unknown): StreamChunk {
  return {
    type: 'finish',
    reason: { kind: 'aborted', failure: { code: 'ABORTED', message: reason instanceof Error ? reason.message : String(reason ?? '已取消') } },
  }
}
