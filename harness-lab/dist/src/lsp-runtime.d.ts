export type LspOperation = 'goToDefinition' | 'findReferences' | 'goToImplementation' | 'hover';
export interface LspQuery {
    readonly operation: LspOperation;
    readonly filePath: string;
    readonly line: number;
    readonly character: number;
    readonly workspaceRoot: string;
}
export type LspResult = {
    readonly kind: 'locations';
    readonly locations: readonly {
        readonly uri: string;
        readonly line: number;
        readonly character: number;
    }[];
} | {
    readonly kind: 'hover';
    readonly contents: string | null;
};
export interface LspProvider {
    readonly id: string;
    readonly extensionToLanguage: Readonly<Record<string, string>>;
    query(request: LspQuery & {
        readonly languageId: string;
    }, signal?: AbortSignal): Promise<LspResult>;
}
export declare class LspRuntimeError extends Error {
    readonly code: string;
    constructor(message: string, code: string);
}
/** 取最终扩展名；例如 foo.d.ts 路由为 .ts，以点开头的文件不会被误判。 */
export declare function finalExtension(path: string): string;
/** LSP 接口边界会原子保留提供方标识及其全部扩展名。 */
export declare class LspRuntime {
    #private;
    register(provider: LspProvider): () => void;
    query(request: LspQuery, signal?: AbortSignal): Promise<LspResult>;
}
