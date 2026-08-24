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
/** 工具注册表同时拥有模型模式和执行函数，但只把模式暴露给大模型。 */
export declare class ToolRegistry {
    #private;
    register(tool: ToolDefinition): () => void;
    schemas(): readonly ToolSchema[];
    /** 解析和校验在调度前完成；坏 JSON 保留原文，使错误可重放。 */
    prepare(block: ToolCallBlock): PreparedToolCall | ToolOutcome;
    effect(prepared: PreparedToolCall): ToolEffect;
    execute(prepared: PreparedToolCall, signal: AbortSignal, context?: ToolExecutionContext): Promise<ToolOutcome>;
}
/** 生成与调用标识相关联的模型可见工具结果消息。 */
export declare function createToolOutcomeMessage(callId: string, outcome: ToolOutcome): import("./domain.ts").Message;
/** 将所有工具管线错误规范化成模型可读文本与稳定错误码。 */
export declare function failureOutcome(code: string, message: string, name?: string): ToolOutcome;
