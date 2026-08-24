import type { JsonValue } from './json.ts';
import type { ToolDefinition } from './domain.ts';
export interface WorkspaceFsOptions {
    readonly maxReadBytes?: number;
    readonly maxWriteBytes?: number;
    readonly maxSearchResults?: number;
    readonly maxOutputChars?: number;
}
export interface SearchMatch extends Readonly<Record<string, JsonValue>> {
    readonly path: string;
    readonly line: number;
    readonly text: string;
}
export declare class WorkspaceFsError extends Error {
    readonly code: string;
    constructor(message: string, code: string);
}
/** 只允许访问一个 canonical workspace；所有返回路径均为相对路径。 */
export declare class WorkspaceFs {
    #private;
    readonly root: string;
    private constructor();
    static open(root: string, options?: WorkspaceFsOptions): Promise<WorkspaceFs>;
    readText(path: string): Promise<{
        path: string;
        content: string;
        truncated: boolean;
    }>;
    writeText(path: string, content: string): Promise<{
        path: string;
        bytes: number;
    }>;
    list(path?: string): Promise<{
        path: string;
        entries: {
            name: string;
            type: string;
        }[];
    }>;
    search(query: string, path?: string): Promise<{
        matches: SearchMatch[];
        truncated: boolean;
    }>;
    /** 词法检查拒绝绝对路径和 ..；真实路径检查另行阻断 symlink 逃逸。 */
    private resolveLexical;
    private resolveExisting;
    /** 创建缺失目录前先验证最近存在祖先的 realpath，防止父级 symlink 逃逸。 */
    private ensureWritableParent;
    private assertInside;
    private display;
}
/** 将 WorkspaceFs 能力包装成四个普通工具，不让 Agent Loop 依赖本地文件 API。 */
export declare function createWorkspaceFsTools(fs: WorkspaceFs): readonly ToolDefinition[];
