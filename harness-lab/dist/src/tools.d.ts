import type { ContentBlock, ToolCallBlock, ToolDefinition, ToolEffect, ToolExecutionContext, ToolSchema } from './domain.ts';
import type { JsonValue } from './json.ts';
export interface ToolOutcome {
    readonly content: readonly ContentBlock[];
    readonly isError: boolean;
    readonly error?: {
        readonly name: string;
        readonly code: string;
    };
}
export interface PreparedToolCall {
    readonly block: ToolCallBlock;
    readonly args: JsonValue;
    readonly mode: 'parallel' | 'exclusive';
}
/** 工具注册表同时拥有模型 schema 和执行函数，但只把 schema 暴露给 LLM。 */
export declare class ToolRegistry {
    #private;
    register(tool: ToolDefinition): () => void;
    schemas(): readonly ToolSchema[];
    /** 解析和校验在调度前完成；坏 JSON 保留原文，使错误可重放。 */
    prepare(block: ToolCallBlock): PreparedToolCall | ToolOutcome;
    effect(prepared: PreparedToolCall): ToolEffect;
    execute(prepared: PreparedToolCall, signal: AbortSignal, context?: ToolExecutionContext): Promise<ToolOutcome>;
}
/** 生成与 callId 相关联的模型可见 tool-result message。 */
export declare function createToolOutcomeMessage(callId: string, outcome: ToolOutcome): import("./domain.ts").Message;
/** 将所有工具管线错误规范化成模型可读文本与稳定错误码。 */
export declare function failureOutcome(code: string, message: string, name?: string): ToolOutcome;
