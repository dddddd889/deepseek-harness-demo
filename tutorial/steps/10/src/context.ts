import type { Message } from './domain';
// 按完整用户 turn 分组，不能只删除 assistant.tool_calls 或其 tool 结果。
export function prepareContext(messages: Message[], system: string, maxChars = 24_000) {
  const turns: Message[][] = [];
  for (const message of messages) {
    if (message.role === 'system') continue;
    if (message.role === 'user') turns.push([]);
    if (!turns.length) throw new Error('历史缺少用户起点');
    turns.at(-1)!.push(structuredClone(message));
  }
  const prefix: Message[] = [{ role: 'system', content: system }];
  const size = () => JSON.stringify([...prefix, ...turns.flat()]).length;
  while (turns.length > 1 && size() > maxChars) turns.shift();
  if (size() > maxChars) throw new Error('当前任务上下文超限，请缩小任务或文件');
  return [...prefix, ...turns.flat()];
}
