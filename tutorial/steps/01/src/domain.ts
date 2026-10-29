// 工具调用的形状与 Chat Completions 保持接近，边界由适配器转换。
export type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };
export type Message = {
  role: 'system' | 'user' | 'assistant' | 'tool'; content: string | null;
  tool_calls?: ToolCall[]; tool_call_id?: string; reasoning_content?: string;
};
// 一次 turn 可以包含多次模型 step；事件身份贯穿 UI、工具和日志。
export type Event = {
  seq: number; sessionId: string; turnId: string; time: string;
  type: string; data: Record<string, any>;
};
export type ToolSpec = { name: string; description: string; parameters: Record<string, any> };
export type Part =
  | { type: 'text'; text: string }
  | { type: 'call'; call: ToolCall }
  | { type: 'usage'; input: number; output: number }
  | { type: 'finish'; reason: string; reasoning?: string };
// Model 只产生语义分片，不负责执行工具、审批或会话管理。
export type Model = (messages: Message[], tools: ToolSpec[], signal: AbortSignal) => AsyncIterable<Part>;
export type Emit = (type: string, data: Record<string, any>) => void;
export type Approval = (call: ToolCall, signal: AbortSignal) => Promise<boolean>;
