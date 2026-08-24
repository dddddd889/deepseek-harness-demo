import type { JsonValue } from './json.ts';
import type { ToolRegistry } from './tools.ts';
export interface McpTool {
    readonly name: string;
    readonly description?: string;
    readonly inputSchema: Readonly<Record<string, JsonValue>>;
}
export interface McpToolPage {
    readonly tools: readonly McpTool[];
    readonly nextCursor?: string;
}
export interface McpTransport {
    listTools(cursor?: string): Promise<McpToolPage>;
    callTool(name: string, args: JsonValue, signal: AbortSignal): Promise<JsonValue>;
}
/** 公共名稳定限定 服务命名空间；截断时用原始二元组摘要防碰撞。 */
export declare function publicMcpToolName(serverName: string, rawName: string): string;
/** MCP 桥接器先完整抓取分页，再原子换代；发现失败时保留旧代次。 */
export declare class McpToolBridge {
    #private;
    constructor(serverName: string, transport: McpTransport, registry: ToolRegistry);
    sync(): Promise<readonly string[]>;
    dispose(): void;
}
