import type { ToolCallBlock } from './domain.ts'
import { Session } from './session.ts'
import { createToolOutcomeMessage, failureOutcome, ToolRegistry } from './tools.ts'
import type { PreparedToolCall, ToolOutcome } from './tools.ts'
import { PermissionService } from './permissions.ts'
import type { SandboxMode } from './domain.ts'

interface Planned {
  readonly call: ToolCallBlock
  readonly prepared: PreparedToolCall | ToolOutcome
}

/** 执行一批模型工具调用：安全调用组成并发池，独占调用形成顺序屏障。 */
export async function executeToolCalls(
  registry: ToolRegistry,
  session: Session,
  turn: number,
  step: number,
  calls: readonly ToolCallBlock[],
  signal: AbortSignal,
  permissions?: PermissionService,
): Promise<void> {
  const planned: Planned[] = calls.map(call => ({ call, prepared: registry.prepare(call) }))
  let index = 0
  while (index < planned.length) {
    const current = planned[index]
    if (!current) throw new Error('工具调度器索引越界')
    if (!isPrepared(current.prepared)) {
      appendCall(session, turn, step, current.call)
      appendResult(session, turn, step, current.call, current.prepared)
      index += 1
      continue
    }

    if (current.prepared.mode === 'exclusive') {
      appendCall(session, turn, step, current.call)
      appendResult(session, turn, step, current.call, await executeAuthorized(
        registry, permissions, session, current.prepared, signal,
      ))
      index += 1
      continue
    }

    const group: { readonly call: ToolCallBlock; readonly prepared: PreparedToolCall }[] = []
    while (index < planned.length) {
      const candidate = planned[index]
      if (!candidate || !isPrepared(candidate.prepared) || candidate.prepared.mode !== 'parallel') break
      group.push({ call: candidate.call, prepared: candidate.prepared })
      index += 1
    }
    for (const item of group) appendCall(session, turn, step, item.call)
    // 审批按模型顺序串行完成；只有获准的工具执行体 才进入并发区。
    const authorized: ({ mode?: SandboxMode } | ToolOutcome)[] = []
    for (const item of group) authorized.push(await authorize(permissions, registry, session, item.prepared, signal))
    const outcomes = await Promise.all(group.map((item, position) => {
      const decision = authorized[position]
      return decision && 'isError' in decision
        ? Promise.resolve(decision)
        : registry.execute(item.prepared, signal, decision?.mode === undefined ? undefined : { sandboxMode: decision.mode })
    }))
    // 执行可以重叠，但持久化结果严格保持模型顺序。
    group.forEach((item, position) => appendResult(session, turn, step, item.call, outcomes[position] ?? {
      content: [{ type: 'text', text: 'Error: 调度结果缺失' }], isError: true,
      error: { name: 'SchedulerError', code: 'MISSING_TOOL_OUTCOME' },
    }))
  }
}

/** 权限异常也必须成为 工具结果，不能破坏 调用与结果 配对。 */
async function executeAuthorized(
  registry: ToolRegistry,
  permissions: PermissionService | undefined,
  session: Session,
  prepared: PreparedToolCall,
  signal: AbortSignal,
): Promise<ToolOutcome> {
  const decision = await authorize(permissions, registry, session, prepared, signal)
  if ('isError' in decision) return decision
  return registry.execute(prepared, signal, decision.mode === undefined ? undefined : { sandboxMode: decision.mode })
}

/** 在 执行体 启动前得到本次调用的有效模式。 */
async function authorize(
  permissions: PermissionService | undefined,
  registry: ToolRegistry,
  session: Session,
  prepared: PreparedToolCall,
  signal: AbortSignal,
): Promise<{ mode?: SandboxMode } | ToolOutcome> {
  if (!permissions) return {}
  try {
    return { mode: await permissions.authorize(session, prepared.block, prepared.args, registry.effect(prepared), signal) }
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
      ? error.code : 'PERMISSION_FAILED'
    return failureOutcome(code, error instanceof Error ? error.message : String(error), error instanceof Error ? error.name : 'PermissionError')
  }
}

/** 已准备工具调用的结构守卫。 */
function isPrepared(value: PreparedToolCall | ToolOutcome): value is PreparedToolCall {
  return 'mode' in value
}

/** 原始工具参数 必须在执行前落账。 */
function appendCall(session: Session, turn: number, step: number, call: ToolCallBlock): void {
  session.append('tool/call', { turn, step, callId: call.id, name: call.name, arguments: call.arguments })
}

/** 结果以 工具结果消息 落账，供下一次模型请求直接投影。 */
function appendResult(session: Session, turn: number, step: number, call: ToolCallBlock, outcome: ToolOutcome): void {
  session.append('tool/result', {
    turn, step, callId: call.id, message: createToolOutcomeMessage(call.id, outcome),
    ...(outcome.error === undefined ? {} : { error: outcome.error }),
  })
}
