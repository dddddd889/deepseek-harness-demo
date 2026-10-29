import type { Approval, Message, Model, ToolCall } from './domain';
import { Session } from './session';
import { Tools } from './tools';
// Loop 只依赖这几个能力；CLI、Web、ACP、Electron 都不能在这里出现。
export type RunOptions = {
  session: Session; model: Model; tools: Tools; prompt: string; signal: AbortSignal;
  turnId?: string; approve?: Approval; maxSteps?: number;
  prepare?: (messages: Message[]) => Message[];
};
export async function runAgent(options: RunOptions) {
  const { session, model, tools, prompt, signal } = options;
  const turnId = options.turnId ?? crypto.randomUUID();
  const emit = (type: string, data: Record<string, any>) => session.emit(turnId, type, data);
  if (!prompt.trim()) throw new Error('任务不能为空');
  emit('start', {});
  emit('messages', { messages: [{ role: 'user', content: prompt }] });
  try {
    for (let step = 0; step < (options.maxSteps ?? 8); step++) {
      signal.throwIfAborted();
      emit('step', { step });
      let text = '';
      let reasoning: string | undefined;
      let reason: string | undefined;
      const calls: ToolCall[] = [];
      const input = options.prepare?.(session.messages) ?? structuredClone(session.messages);
      for await (const part of model(input, tools.specs(), signal)) {
        signal.throwIfAborted();
        if (reason && part.type !== 'usage') throw new Error('终止帧之后出现额外内容');
        if (part.type === 'text') { text += part.text; emit('text', { text: part.text }); }
        if (part.type === 'call') calls.push(part.call);
        if (part.type === 'usage') emit('usage', { input: part.input, output: part.output });
        if (part.type === 'finish') { reason = part.reason; reasoning = part.reasoning; }
      }
      signal.throwIfAborted();
      if (!reason) throw new Error('模型流缺少终止帧');
      if (calls.length && reason !== 'tool_calls') throw new Error('工具调用与终止原因不一致');
      if (!calls.length && reason !== 'stop') throw new Error('模型未正常完成：' + reason);
      if (new Set(calls.map(call => call.id)).size !== calls.length) throw new Error('工具调用标识重复');
      const assistant: Message = { role: 'assistant', content: text || null,
        ...(calls.length ? { tool_calls: calls } : {}), ...(reasoning ? { reasoning_content: reasoning } : {}) };
      const batch: Message[] = [assistant];
      for (const call of calls) {
        signal.throwIfAborted();
        emit('tool_start', { call });
        let result: string;
        let failed = false;
        try {
          const tool = tools.get(call.function.name);
          // 默认拒绝写操作；审批由入口注入，Loop 不知道按钮或终端的存在。
          if (tool.mutates && !(await options.approve?.(call, signal))) throw new Error('用户拒绝操作');
          signal.throwIfAborted();
          result = await tools.execute(call, signal);
          signal.throwIfAborted();
        } catch (error) {
          if (signal.aborted) throw error;
          failed = true;
          result = JSON.stringify({ error: String(error) });
        }
        emit('tool_end', { callId: call.id, result, failed });
        batch.push({ role: 'tool', tool_call_id: call.id, content: result });
      }
      // 整组 assistant+tool 原子提交，取消不能留下缺少结果的 tool_call。
      emit('messages', { messages: batch });
      if (!calls.length) {
        emit('done', { reason: 'stop' });
        return 'stop' as const;
      }
    }
    throw new Error('超过最大模型步数');
  } catch (error) {
    const reason = signal.aborted ? 'cancelled' : 'error';
    emit('done', { reason, error: reason === 'error' ? String(error) : undefined });
    return reason;
  }
}
