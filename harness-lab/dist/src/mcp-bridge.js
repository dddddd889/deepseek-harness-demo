import { createHash } from 'node:crypto';
import { assertJsonValue } from "./json.js";
/** 公共名稳定限定 服务命名空间；截断时用原始二元组摘要防碰撞。 */
export function publicMcpToolName(serverName, rawName) {
    const normalized = `mcp__${serverName}__${rawName}`.replace(/[^A-Za-z0-9_-]/g, '_');
    if (normalized.length <= 64)
        return normalized;
    const hash = createHash('sha256').update(`${serverName}\0${rawName}`).digest('hex').slice(0, 10);
    return `${normalized.slice(0, 53)}_${hash}`;
}
/** MCP 桥接器先完整抓取分页，再原子换代；发现失败时保留旧代次。 */
export class McpToolBridge {
    #serverName;
    #transport;
    #registry;
    #generation = [];
    constructor(serverName, transport, registry) {
        this.#serverName = serverName;
        this.#transport = transport;
        this.#registry = registry;
    }
    async sync() {
        const definitions = [];
        const publicNames = new Set();
        const cursors = new Set();
        let cursor;
        do {
            const page = await this.#transport.listTools(cursor);
            for (const tool of page.tools) {
                const publicName = publicMcpToolName(this.#serverName, tool.name);
                if (publicNames.has(publicName))
                    throw new Error(`MCP 工具名称冲突：${tool.name}`);
                publicNames.add(publicName);
                definitions.push(this.#definition(publicName, tool));
            }
            cursor = page.nextCursor;
            if (cursor !== undefined && cursors.has(cursor))
                throw new Error(`MCP 分页 cursor 循环：${cursor}`);
            if (cursor !== undefined)
                cursors.add(cursor);
        } while (cursor !== undefined);
        const previous = this.#generation;
        for (const entry of previous)
            entry.dispose();
        const next = [];
        try {
            for (const definition of definitions)
                next.push({ definition, dispose: this.#registry.register(definition) });
        }
        catch (error) {
            for (const entry of next)
                entry.dispose();
            const restored = [];
            for (const entry of previous)
                restored.push({ definition: entry.definition, dispose: this.#registry.register(entry.definition) });
            this.#generation = restored;
            throw error;
        }
        this.#generation = next;
        return definitions.map(definition => definition.name);
    }
    dispose() {
        for (const entry of this.#generation)
            entry.dispose();
        this.#generation = [];
    }
    #definition(publicName, tool) {
        return {
            name: publicName,
            description: tool.description ?? '',
            parameters: tool.inputSchema,
            execute: async (args, signal) => {
                assertJsonValue(args);
                return this.#transport.callTool(tool.name, args, signal);
            },
            effect: () => ({ minimumMode: 'danger-full-access', reason: `MCP server ${this.#serverName} 是外部能力边界` }),
        };
    }
}
//# sourceMappingURL=mcp-bridge.js.map