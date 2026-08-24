import type { ImageAttachmentRef } from './domain.ts';
export interface AttachmentLimits {
    readonly maxImageBytes: number;
    readonly maxImagePixels: number;
    readonly mediaTypes: readonly ImageAttachmentRef['mediaType'][];
}
export declare class AttachmentError extends Error {
    readonly code: string;
    constructor(message: string, code: string);
}
/** 内容寻址图片仓库：引用不暴露路径，保存前完整解码并验证声明类型。 */
export declare class LocalAttachmentStore {
    #private;
    constructor(root: string, limits: AttachmentLimits);
    saveImage(input: {
        readonly data: Uint8Array;
        readonly mediaType: ImageAttachmentRef['mediaType'];
        readonly name?: string;
    }): Promise<ImageAttachmentRef>;
    /** 冷读取同时复验 标识、字节、解码元数据，引用不能替代完整性检查。 */
    readImage(ref: ImageAttachmentRef): Promise<Uint8Array>;
}
