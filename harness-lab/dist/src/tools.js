import { createMessage } from "./domain.js";
import { assertJsonValue, snapshotJson } from "./json.js";
/** 工具注册表同时拥有模型模式和执行函数，但只把模式暴露给大模型。 */
export class ToolRegistry {
    #tools = new Map();
    register(tool) {
        if (this.#tools.has(tool.name))
            throw new Error(`工具已存在：${tool.name}`);
        this.#tools.set(tool.name, tool);
        return () => this.#tools.delete(tool.name);
    }
    schemas() {
        return [...this.#tools.values()].map(tool => snapshotJson({
            name: tool.name, description: tool.description, parameters: tool.parameters,
        }));
    }
    /** 解析和校验在调度前完成；坏 JSON 保留原文，使错误可重放。 */
    prepare(block) {
        const tool = this.#tools.get(block.name);
        if (!tool)
            return failureOutcome('UNKNOWN_TOOL', `未知工具：${block.name}`);
        let parsed;
        try {
            parsed = block.arguments.length === 0 ? {} : JSON.parse(block.arguments);
        }
        catch {
            parsed = block.arguments;
        }
        try {
            assertJsonValue(parsed);
            validateSchema(tool.parameters, parsed);
            const args = snapshotJson(parsed);
            const mode = tool.isConcurrencySafe?.(args) === true ? 'parallel' : 'exclusive';
            return { block, args, mode };
        }
        catch (error) {
            return failureOutcome('INVALID_ARGUMENTS', error instanceof Error ? error.message : String(error));
        }
    }
    effect(prepared) {
        const tool = this.#tools.get(prepared.block.name);
        return tool?.effect?.(prepared.args) ?? {
            minimumMode: 'danger-full-access',
            reason: `工具 ${prepared.block.name} 未声明权限效果，按最高权限处理`,
        };
    }
    async execute(prepared, signal, context) {
        const tool = this.#tools.get(prepared.block.name);
        if (!tool)
            return failureOutcome('UNKNOWN_TOOL', `未知工具：${prepared.block.name}`);
        if (signal.aborted)
            return failureOutcome('TOOL_ABORTED', '工具在执行前已取消', 'AbortError');
        try {
            const value = await tool.execute(prepared.args, signal, context);
            assertJsonValue(value);
            const snapshot = snapshotJson(value);
            const content = tool.render?.(snapshot) ?? [{ type: 'text', text: JSON.stringify(snapshot) }];
            assertJsonValue(content);
            return { content: snapshotJson(content), isError: false };
        }
        catch (error) {
            if (signal.aborted)
                return failureOutcome('TOOL_ABORTED', error instanceof Error ? error.message : '工具已取消', 'AbortError');
            const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
                ? error.code
                : 'TOOL_EXECUTION_FAILED';
            return failureOutcome(code, error instanceof Error ? error.message : String(error), error instanceof Error ? error.name : 'Error');
        }
    }
}
/** 生成与调用标识相关联的模型可见工具结果消息。 */
export function createToolOutcomeMessage(callId, outcome) {
    return createMessage({
        role: 'user', source: { kind: 'tool', callId },
        content: [{ type: 'tool-result', toolCallId: callId, content: outcome.content, ...(outcome.isError ? { isError: true } : {}) }],
    });
}
/** 教学实现覆盖常用 JSON 模式子集，并在错误中携带参数路径。 */
function validateSchema(schema, value, path = '$') {
    if (Array.isArray(schema.enum) && !schema.enum.some(candidate => JSON.stringify(candidate) === JSON.stringify(value))) {
        throw new TypeError(`${path} 不在 enum 中`);
    }
    const type = schema.type;
    if (typeof type === 'string' && !matchesType(type, value))
        throw new TypeError(`${path} 应为 ${type}`);
    if (typeof value === 'number') {
        if (typeof schema.minimum === 'number' && value < schema.minimum)
            throw new TypeError(`${path} 小于 minimum`);
        if (typeof schema.maximum === 'number' && value > schema.maximum)
            throw new TypeError(`${path} 大于 maximum`);
    }
    if (typeof value === 'string' && typeof schema.minLength === 'number' && value.length < schema.minLength) {
        throw new TypeError(`${path} 短于 minLength`);
    }
    if (Array.isArray(value) && isSchema(schema.items)) {
        value.forEach((item, index) => validateSchema(schema.items, item, `${path}[${index}]`));
    }
    if (isPlainJsonObject(value)) {
        const properties = isSchema(schema.properties) ? schema.properties : {};
        if (Array.isArray(schema.required)) {
            for (const key of schema.required) {
                if (typeof key === 'string' && !Object.hasOwn(value, key))
                    throw new TypeError(`${path}.${key} 是必填项`);
            }
        }
        for (const [key, child] of Object.entries(value)) {
            const childSchema = properties[key];
            if (isSchema(childSchema))
                validateSchema(childSchema, child, `${path}.${key}`);
            else if (schema.additionalProperties === false)
                throw new TypeError(`${path}.${key} 不允许出现`);
        }
    }
}
/** 判断 JSON 模式的基本类型。 */
function matchesType(type, value) {
    if (type === 'null')
        return value === null;
    if (type === 'array')
        return Array.isArray(value);
    if (type === 'object')
        return isPlainJsonObject(value);
    if (type === 'integer')
        return typeof value === 'number' && Number.isInteger(value);
    return typeof value === type;
}
/** JSON 普通对象守卫。 */
function isPlainJsonObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** JSON 模式节点守卫。 */
function isSchema(value) {
    return value !== undefined && isPlainJsonObject(value);
}
/** 将所有工具管线错误规范化成模型可读文本与稳定错误码。 */
export function failureOutcome(code, message, name = 'ToolError') {
    return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true, error: { name, code } };
}
//# sourceMappingURL=tools.js.map