import type { FinishReason, Message } from './domain.ts'
import { BlockAssembler, LlmRuntime } from './llm.ts'
import type { GenerateOptions } from './llm.ts'
import { Session } from './session.ts'

export interface ModelStepResult {
  readonly finish: FinishReason
  readonly message?: Message
}

/** 执行一次模型流：先逐帧落账，再组装最终消息；失败流不会伪造 assistant message。 */
export async function runModelStep(
  runtime: LlmRuntime,
  session: Session,
  turn: number,
  step: number,
  options: GenerateOptions,
  signal: AbortSignal,
): Promise<ModelStepResult> {
  session.append('request/header', {
    header: {
      provider: options.provider,
      model: options.model,
      ...(options.system === undefined ? {} : { system: options.system }),
      ...(options.tools === undefined ? {} : { tools: options.tools }),
    },
    reason: 'initial',
  })

  const assembler = new BlockAssembler()
  for await (const chunk of runtime.stream(options, signal)) {
    session.append('assistant/chunk', { turn, step, chunk })
    assembler.push(chunk)
  }

  if (assembler.finish.kind === 'error' || assembler.finish.kind === 'aborted') {
    return { finish: assembler.finish }
  }
  const message = assembler.message(options.provider, options.model)
  session.append('assistant/message', {
    turn,
    step,
    message,
    ...(assembler.usage === undefined ? {} : { usage: assembler.usage }),
  })
  return { finish: assembler.finish, message }
}
