import { createHash, randomBytes } from 'node:crypto';
import { mkdir, open, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
/** 把任意建议名编码为单个安全路径段。 */
export function encodeSegment(raw) {
    const encoded = [...raw].map(character => /^[A-Za-z0-9._-]$/.test(character) && character !== '~'
        ? character
        : `~${character.codePointAt(0)?.toString(16).toUpperCase().padStart(4, '0')}`).join('');
    return encoded === '' || encoded === '.' || encoded === '..' ? '~empty' : encoded;
}
/** 本地 spill：session 隔离、随机文件名、0600 独占写，并记录摘要校验。 */
export class LocalSpillStore {
    #root;
    constructor(root) {
        this.#root = resolve(root);
    }
    async saveText(sessionId, suggestedName, content) {
        const sessionHash = createHash('sha256').update(sessionId).digest('hex').slice(0, 12);
        const directory = join(this.#root, `session-${sessionHash}`);
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const path = join(directory, `${randomBytes(6).toString('hex')}-${encodeSegment(suggestedName)}`);
        const handle = await open(path, 'wx', 0o600);
        try {
            await handle.writeFile(content, 'utf8');
        }
        finally {
            await handle.close();
        }
        return {
            locator: path,
            bytes: Buffer.byteLength(content, 'utf8'),
            sha256: createHash('sha256').update(content).digest('hex'),
            retrievalHint: '使用 read 的 offset/limit 分段读取，或 grep 搜索此路径。',
        };
    }
    /** 读取时复验摘要，避免把损坏文件静默喂给模型。 */
    async readText(ref) {
        const content = await readFile(ref.locator, 'utf8');
        const sha256 = createHash('sha256').update(content).digest('hex');
        if (sha256 !== ref.sha256 || Buffer.byteLength(content, 'utf8') !== ref.bytes) {
            throw new Error('spill 文件完整性校验失败');
        }
        return content;
    }
}
/** 超阈值时只向模型返回短引用，完整文本进入 spill store。 */
export async function spillIfNeeded(store, input, thresholdBytes) {
    if (Buffer.byteLength(input.content, 'utf8') <= thresholdBytes)
        return { modelText: input.content };
    const ref = await store.saveText(input.sessionId, input.suggestedName, input.content);
    return {
        modelText: `[输出过大，已落盘：${ref.locator}，${ref.bytes} bytes。${ref.retrievalHint}]`,
        ref,
    };
}
//# sourceMappingURL=spill-store.js.map