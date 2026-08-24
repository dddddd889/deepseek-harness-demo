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
/** 只允许访问一个 规范化工作区；所有返回路径均为相对路径。 */
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
    /** 词法检查拒绝绝对路径和 ..；真实路径检查另行阻断符号链接逃逸。 */
    private resolveLexical;
    private resolveExisting;
    /** 创建缺失目录前先验证最近存在祖先的真实路径，防止父级符号链接逃逸。 */
    private ensureWritableParent;
    private assertInside;
    private display;
}
/** 将工作区文件系统能力包装成四个普通工具，不让智能体循环依赖本地文件接口。 */
export declare function createWorkspaceFsTools(fs: WorkspaceFs): readonly ToolDefinition[];
