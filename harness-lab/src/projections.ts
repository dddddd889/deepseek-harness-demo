import type { CallId, Message, SessionEvent, TokenUsage } from './domain.ts'

export interface UsageTotals {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
  readonly reasoningTokens: number
}

export interface LifecycleView {
  readonly status: 'idle' | 'running'
  readonly turns: number
  readonly steps: number
  readonly openTurn: number | null
  readonly openStep: number | null
  readonly pendingToolCalls: readonly CallId[]
}

/** 重放 追加与替换 得到当前模型可见事件；替换 边界必须仍在 模型可见面 上。 */
export function deriveSurface(events: readonly SessionEvent[]): readonly SessionEvent[] {
  const surface: SessionEvent[] = []
  for (const event of events) {
    const implicitlyVisible = event.type === 'user/message'
      || (event.type === 'assistant/message' && event.data.message.content.length > 0)
      || event.type === 'tool/result'
    if (event.surfaceOp === undefined && !implicitlyVisible) continue
    if (event.surfaceOp === undefined || event.surfaceOp === 'append') {
      surface.push(event)
      continue
    }
    const replacement = event.surfaceOp
    const start = surface.findIndex(candidate => candidate.seq === replacement.start)
    const end = surface.findIndex(candidate => candidate.seq === replacement.end)
    if (start < 0 || end < start) {
      throw new Error(`surface replace 无效（seq=${event.seq}）：${event.surfaceOp.start}-${event.surfaceOp.end}`)
    }
    surface.splice(start, end - start + 1, event)
  }
  return surface
}

/** 从事实日志派生发给模型的消息历史；流式增量和纯 用量 消息不进入上下文。 */
export function deriveMessages(events: readonly SessionEvent[]): readonly Message[] {
  const messages: Message[] = []
  for (const event of deriveSurface(events)) {
    if (event.type === 'user/message') messages.push(event.data)
    if (event.type === 'assistant/message' && event.data.message.content.length > 0) messages.push(event.data.message)
    if (event.type === 'tool/result') messages.push(event.data.message)
  }
  return messages
}

/** 按 轮次与步骤 覆盖 用量 样本，避免 数据块 与最终 消息 对同一次请求重复计费。 */
export function foldTokenUsage(events: readonly SessionEvent[]): UsageTotals {
  const samples = new Map<string, TokenUsage>()
  for (const event of events) {
    let usage: TokenUsage | undefined
    let turn: number | undefined
    let step: number | undefined
    if (event.type === 'assistant/chunk' && event.data.chunk.type === 'usage') {
      ;({ turn, step } = event.data)
      usage = event.data.chunk.usage
    } else if (event.type === 'assistant/message' && event.data.usage) {
      ;({ turn, step, usage } = event.data)
    }
    if (usage && turn !== undefined && step !== undefined) samples.set(`${turn}:${step}`, usage)
  }

  let inputTokens = 0
  let outputTokens = 0
  let cacheReadTokens = 0
  let cacheWriteTokens = 0
  let reasoningTokens = 0
  for (const usage of samples.values()) {
    inputTokens += usage.inputTokens
    outputTokens += usage.outputTokens
    cacheReadTokens += usage.cacheReadTokens ?? 0
    cacheWriteTokens += usage.cacheWriteTokens ?? 0
    reasoningTokens += usage.reasoningTokens ?? 0
  }
  return { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, reasoningTokens }
}

/** 重放事件并校验 轮次与步骤/工具 生命周期；错误携带 序号，便于定位损坏日志。 */
export function inspectLifecycle(events: readonly SessionEvent[]): LifecycleView {
  let openTurn: number | null = null
  let openStep: number | null = null
  let turns = 0
  let steps = 0
  const pending = new Set<CallId>()
  const started = new Set<CallId>()

  for (const event of events) {
    const fail = (reason: string): never => {
      throw new Error(`生命周期事件无效（seq=${event.seq}, type=${event.type}）：${reason}`)
    }
    const requireTurn = (turn: number): void => {
      if (openTurn !== turn) fail(`期望当前 turn=${turn}，实际为 ${openTurn ?? '无'}`)
    }
    const requireStep = (turn: number, step: number): void => {
      requireTurn(turn)
      if (openStep !== step) fail(`期望当前 step=${step}，实际为 ${openStep ?? '无'}`)
    }

    switch (event.type) {
      case 'turn/start':
        if (openTurn !== null) fail('已有未结束的 turn')
        openTurn = event.data.turn
        pending.clear()
        started.clear()
        turns += 1
        break
      case 'turn/end':
        requireTurn(event.data.turn)
        if (openStep !== null) fail('仍有未结束的 step')
        if (pending.size > 0) fail('仍有未完成的工具调用')
        openTurn = null
        break
      case 'step/start':
        requireTurn(event.data.turn)
        if (openStep !== null) fail('已有未结束的 step')
        openStep = event.data.step
        steps += 1
        break
      case 'step/end':
        requireStep(event.data.turn, event.data.step)
        if (pending.size > 0) fail('仍有未完成的工具调用')
        openStep = null
        break
      case 'assistant/chunk':
        requireStep(event.data.turn, event.data.step)
        break
      case 'assistant/message':
        requireStep(event.data.turn, event.data.step)
        for (const block of event.data.message.content) {
          if (block.type === 'tool-call') pending.add(block.id)
        }
        break
      case 'request/header':
        if (openTurn === null || openStep === null) fail('请求头不属于任何 step')
        break
      case 'tool/call':
        requireStep(event.data.turn, event.data.step)
        if (started.has(event.data.callId)) fail(`工具调用 ${event.data.callId} 重复`)
        pending.add(event.data.callId)
        started.add(event.data.callId)
        break
      case 'tool/result':
        requireStep(event.data.turn, event.data.step)
        if (!pending.delete(event.data.callId)) fail(`找不到工具调用 ${event.data.callId}`)
        started.delete(event.data.callId)
        break
      case 'user/message':
        if (openTurn === null) fail('用户消息不属于任何 turn')
        break
      case 'approval/asked':
      case 'approval/decided':
        if (openTurn === null) fail('审批审计不属于任何 turn')
        break
      case 'sandbox/mode':
      case 'approval/policy':
      case 'compaction/start':
      case 'compaction/summary':
      case 'compaction/end':
        break
    }
  }

  return {
    status: openTurn === null ? 'idle' : 'running',
    turns,
    steps,
    openTurn,
    openStep,
    pendingToolCalls: [...pending],
  }
}
