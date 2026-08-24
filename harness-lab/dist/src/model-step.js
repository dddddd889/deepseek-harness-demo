import { BlockAssembler, LlmRuntime } from "./llm.js";
import { Session } from "./session.js";
/** 执行一次模型流：先逐帧落账，再组装最终消息；失败流不会伪造助手消息。 */
export async function runModelStep(runtime, session, turn, step, options, signal) {
    session.append('request/header', {
        header: {
            provider: options.provider,
            model: options.model,
            ...(options.system === undefined ? {} : { system: options.system }),
            ...(options.tools === undefined ? {} : { tools: options.tools }),
        },
        reason: 'initial',
    });
    const assembler = new BlockAssembler();
    for await (const chunk of runtime.stream(options, signal)) {
        session.append('assistant/chunk', { turn, step, chunk });
        assembler.push(chunk);
    }
    if (assembler.finish.kind === 'error' || assembler.finish.kind === 'aborted') {
        return { finish: assembler.finish };
    }
    const message = assembler.message(options.provider, options.model);
    session.append('assistant/message', {
        turn,
        step,
        message,
        ...(assembler.usage === undefined ? {} : { usage: assembler.usage }),
    });
    return { finish: assembler.finish, message };
}
//# sourceMappingURL=model-step.js.map