import { createHash, randomBytes } from 'node:crypto'
import { mkdir, open, readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'

export interface SpillRef {
  readonly locator: string
  readonly bytes: number
  readonly sha256: string
  readonly retrievalHint: string
}

/** 把任意建议名编码为单个安全路径段。 */
export function encodeSegment(raw: string): string {
  const encoded = [...raw].map(character => /^[A-Za-z0-9._-]$/.test(character) && character !== '~'
    ? character
    : `~${character.codePointAt(0)?.toString(16).toUpperCase().padStart(4, '0')}`).join('')
  return encoded === '' || encoded === '.' || encoded === '..' ? '~empty' : encoded
}

/** 本地溢出存储：会话隔离、随机文件名、0600 独占写，并记录摘要校验。 */
export class LocalSpillStore {
  readonly #root: string

  constructor(root: string) {
    this.#root = resolve(root)
  }

  async saveText(sessionId: string, suggestedName: string, content: string): Promise<SpillRef> {
    const sessionHash = createHash('sha256').update(sessionId).digest('hex').slice(0, 12)
    const directory = join(this.#root, `session-${sessionHash}`)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const path = join(directory, `${randomBytes(6).toString('hex')}-${encodeSegment(suggestedName)}`)
    const handle = await open(path, 'wx', 0o600)
    try {
      await handle.writeFile(content, 'utf8')
    } finally {
      await handle.close()
    }
    return {
      locator: path,
      bytes: Buffer.byteLength(content, 'utf8'),
      sha256: createHash('sha256').update(content).digest('hex'),
      retrievalHint: '使用 read 的 offset/limit 分段读取，或 grep 搜索此路径。',
    }
  }

  /** 读取时复验摘要，避免把损坏文件静默喂给模型。 */
  async readText(ref: SpillRef): Promise<string> {
    const content = await readFile(ref.locator, 'utf8')
    const sha256 = createHash('sha256').update(content).digest('hex')
    if (sha256 !== ref.sha256 || Buffer.byteLength(content, 'utf8') !== ref.bytes) {
      throw new Error('溢出文件完整性校验失败')
    }
    return content
  }
}

/** 超阈值时只向模型返回短引用，完整文本进入 溢出存储。 */
export async function spillIfNeeded(
  store: LocalSpillStore,
  input: { readonly sessionId: string; readonly suggestedName: string; readonly content: string },
  thresholdBytes: number,
): Promise<{ readonly modelText: string; readonly ref?: SpillRef }> {
  if (Buffer.byteLength(input.content, 'utf8') <= thresholdBytes) return { modelText: input.content }
  const ref = await store.saveText(input.sessionId, input.suggestedName, input.content)
  return {
    modelText: `[输出过大，已落盘：${ref.locator}，${ref.bytes} bytes。${ref.retrievalHint}]`,
    ref,
  }
}
