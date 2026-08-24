export interface WebSearchSource {
    readonly url: string;
    readonly title?: string;
    readonly snippet?: string;
}
export interface WebSearchResult {
    readonly content?: string;
    readonly sources: readonly WebSearchSource[];
    readonly truncated: boolean;
}
export interface WebSearchProvider {
    readonly id: string;
    available(): boolean;
    search(query: string, maxResults: number, signal?: AbortSignal): Promise<WebSearchResult>;
}
export interface WebFetchResult {
    readonly url: string;
    readonly statusCode: number;
    readonly content: string;
    readonly kind: 'html' | 'text';
    readonly truncated: boolean;
}
export interface WebFetchProvider {
    readonly id: string;
    available(): boolean;
    fetch(url: string, signal?: AbortSignal): Promise<WebFetchResult>;
}
export declare class WebRuntimeError extends Error {
    readonly code: string;
    constructor(message: string, code: string);
}
/** 网页接口边界在执行时选择提供方，绝不依赖注册顺序。 */
export declare class WebRuntime {
    #private;
    constructor(config?: {
        readonly searchProvider?: string;
        readonly fetchProvider?: string;
    });
    registerSearch(provider: WebSearchProvider): () => void;
    registerFetch(provider: WebFetchProvider): () => void;
    search(query: string, maxResults: number, signal?: AbortSignal): Promise<WebSearchResult>;
    fetch(url: string, signal?: AbortSignal): Promise<WebFetchResult>;
}
