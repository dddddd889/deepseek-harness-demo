export interface SpillRef {
    readonly locator: string;
    readonly bytes: number;
    readonly sha256: string;
    readonly retrievalHint: string;
}
/** 把任意建议名编码为单个安全路径段。 */
export declare function encodeSegment(raw: string): string;
/** 本地 spill：session 隔离、随机文件名、0600 独占写，并记录摘要校验。 */
export declare class LocalSpillStore {
    #private;
    constructor(root: string);
    saveText(sessionId: string, suggestedName: string, content: string): Promise<SpillRef>;
    /** 读取时复验摘要，避免把损坏文件静默喂给模型。 */
    readText(ref: SpillRef): Promise<string>;
}
/** 超阈值时只向模型返回短引用，完整文本进入 spill store。 */
export declare function spillIfNeeded(store: LocalSpillStore, input: {
    readonly sessionId: string;
    readonly suggestedName: string;
    readonly content: string;
}, thresholdBytes: number): Promise<{
    readonly modelText: string;
    readonly ref?: SpillRef;
}>;
