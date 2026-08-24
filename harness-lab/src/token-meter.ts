import type { ContentBlock, Message, RequestHeader, SessionEvent, TokenUsage } from './domain.ts'
import { deriveSurface } from './projections.ts'

export interface PricedSurfaceNode {
  readonly seq: number
  readonly tokens: number
}

export interface TokenMeasurement {
  readonly nodes: readonly PricedSurfaceNode[]
  readonly messageTokens: number
  readonly systemTokens: number
  readonly toolsTokens: number
  readonly heuristicPromptTokens: number
}

export interface ContextPressure {
  /** 最近一次 provider 实测的 prompt，不含输出。 */
  readonly pressureTokens?: number
  /** provider 锚点加 surface 变化量，表示下一次请求。 */
  readonly projectedTokens?: number
  readonly contextWindow?: number
  readonly ratio?: number
}

/** 固定密度估算器只用于相对决策；账单必须使用 provider usage。 */
export function estimateText(text: string): number {
  return text.length === 0 ? 0 : Math.ceil(Buffer.byteLength(text, 'utf8') / 4)
}

/** 估算一个内容块，并给协议封装留出固定开销。 */
export function estimateBlock(block: ContentBlock): number {
  switch (block.type) {
    case 'text':
    case 'reasoning':
      return 2 + estimateText(block.text)
    case 'tool-call':
      return 8 + estimateText(block.id) + estimateText(block.name) + estimateText(block.arguments)
    case 'tool-result':
      return 8 + estimateText(block.toolCallId)
        + block.content.reduce((total, child) => total + estimateBlock(child), 0)
    case 'image':
      return 32 + Math.ceil((block.attachment.width * block.attachment.height) / 10_000)
  }
}

/** 估算模型消息价格；角色和消息 envelope 也占 token。 */
export function estimateMessage(message: Message): number {
  return 6 + message.content.reduce((total, block) => total + estimateBlock(block), 0)
}

function eventMessage(event: SessionEvent): Message | undefined {
  if (event.type === 'user/message') return event.data
  if (event.type === 'assistant/message') return event.data.message
  if (event.type === 'tool/result') return event.data.message
  return undefined
}

/** 对当前 surface 定价，同时把 system/tool schemas 分桶展示。 */
export function measureTokens(events: readonly SessionEvent[]): TokenMeasurement {
  const nodes = deriveSurface(events).flatMap(event => {
    const message = eventMessage(event)
    return message === undefined ? [] : [{ seq: event.seq, tokens: estimateMessage(message) }]
  })
  const headerEvent = [...events].reverse().find(event => event.type === 'request/header')
  const header: RequestHeader | undefined = headerEvent?.type === 'request/header'
    ? headerEvent.data.header
    : undefined
  const systemTokens = estimateText(header?.system ?? '')
  const toolsTokens = estimateText(JSON.stringify(header?.tools ?? []))
  const messageTokens = nodes.reduce((total, node) => total + node.tokens, 0)
  return {
    nodes,
    messageTokens,
    systemTokens,
    toolsTokens,
    heuristicPromptTokens: messageTokens + systemTokens + toolsTokens,
  }
}

function promptUsage(usage: TokenUsage): number {
  return usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
}

/** provider usage 为锚点；锚点之后只用 surface 的估算增减修正下一请求压力。 */
export function projectContextPressure(
  events: readonly SessionEvent[],
  contextWindow?: number,
): ContextPressure {
  let sampledPressure: number | undefined
  let sampledSurfaceTokens: number | undefined
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]
    if (event === undefined) continue
    let usage: TokenUsage | undefined
    if (event.type === 'assistant/chunk' && event.data.chunk.type === 'usage') usage = event.data.chunk.usage
    if (event.type === 'assistant/message') usage = event.data.usage
    if (usage !== undefined) {
      sampledPressure = promptUsage(usage)
      sampledSurfaceTokens = measureTokens(events.slice(0, index)).messageTokens
    }
  }
  if (sampledPressure === undefined || sampledSurfaceTokens === undefined) {
    return contextWindow === undefined ? {} : { contextWindow }
  }
  const projectedTokens = Math.max(
    0,
    sampledPressure + measureTokens(events).messageTokens - sampledSurfaceTokens,
  )
  return {
    pressureTokens: sampledPressure,
    projectedTokens,
    ...contextWindow === undefined ? {} : {
      contextWindow,
      ratio: projectedTokens / contextWindow,
    },
  }
}
