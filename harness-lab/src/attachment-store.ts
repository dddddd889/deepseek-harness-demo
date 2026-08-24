import { createHash } from 'node:crypto'
import { mkdir, open, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, join, resolve } from 'node:path'
import type { ImageAttachmentRef } from './domain.ts'

export interface AttachmentLimits {
  readonly maxImageBytes: number
  readonly maxImagePixels: number
  readonly mediaTypes: readonly ImageAttachmentRef['mediaType'][]
}

interface SharpMetadata { readonly format?: string; readonly width?: number; readonly height?: number }
interface SharpImage { metadata(): Promise<SharpMetadata> }
type SharpFactory = (data: Uint8Array, options?: { readonly failOn?: string }) => SharpImage

const requireFromAttachmentPackage = createRequire(
  new URL('../../deepseek-harness/packages/attachment/attachment-local/package.json', import.meta.url),
)
const sharp = requireFromAttachmentPackage('sharp') as SharpFactory
const formatToMedia = new Map<string, ImageAttachmentRef['mediaType']>([
  ['png', 'image/png'], ['jpeg', 'image/jpeg'], ['webp', 'image/webp'], ['gif', 'image/gif'],
])

export class AttachmentError extends Error {
  readonly code: string
  constructor(message: string, code: string) { super(message); this.code = code }
}

/** 内容寻址图片仓库：引用不暴露路径，保存前完整解码并验证声明类型。 */
export class LocalAttachmentStore {
  readonly #root: string
  readonly #limits: AttachmentLimits

  constructor(root: string, limits: AttachmentLimits) {
    this.#root = resolve(root, 'attachments', 'v1')
    this.#limits = limits
  }

  async saveImage(input: {
    readonly data: Uint8Array
    readonly mediaType: ImageAttachmentRef['mediaType']
    readonly name?: string
  }): Promise<ImageAttachmentRef> {
    if (!this.#limits.mediaTypes.includes(input.mediaType)) throw new AttachmentError('图片类型不允许', 'ATTACHMENT_MEDIA_TYPE')
    if (input.data.byteLength > this.#limits.maxImageBytes) throw new AttachmentError('图片字节超限', 'ATTACHMENT_TOO_LARGE')
    const metadata = await this.#metadata(input.data)
    if (metadata.mediaType !== input.mediaType) throw new AttachmentError('声明类型与解码类型不符', 'ATTACHMENT_MEDIA_MISMATCH')
    if (metadata.width * metadata.height > this.#limits.maxImagePixels) throw new AttachmentError('图片像素超限', 'ATTACHMENT_TOO_MANY_PIXELS')
    const sha256 = createHash('sha256').update(input.data).digest('hex')
    const directory = join(this.#root, sha256.slice(0, 2))
    const path = join(directory, sha256)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    try {
      const handle = await open(path, 'wx', 0o600)
      try { await handle.writeFile(input.data) } finally { await handle.close() }
    } catch (error: unknown) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
      if (code !== 'EEXIST') throw error
      const existing = await readFile(path)
      if (createHash('sha256').update(existing).digest('hex') !== sha256) {
        throw new AttachmentError('已存附件摘要不一致', 'ATTACHMENT_CORRUPT')
      }
    }
    return {
      attachmentId: `sha256:${sha256}`,
      mediaType: metadata.mediaType,
      bytes: input.data.byteLength,
      width: metadata.width,
      height: metadata.height,
      ...input.name === undefined ? {} : { name: basename(input.name).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 255) },
    }
  }

  /** 冷读取同时复验 标识、字节、解码元数据，引用不能替代完整性检查。 */
  async readImage(ref: ImageAttachmentRef): Promise<Uint8Array> {
    const match = /^sha256:([a-f0-9]{64})$/.exec(ref.attachmentId)
    if (match?.[1] === undefined) throw new AttachmentError('附件标识无效', 'ATTACHMENT_INVALID_ID')
    const data = await readFile(join(this.#root, match[1].slice(0, 2), match[1]))
    if (createHash('sha256').update(data).digest('hex') !== match[1] || data.byteLength !== ref.bytes) {
      throw new AttachmentError('附件完整性失败', 'ATTACHMENT_CORRUPT')
    }
    const metadata = await this.#metadata(data)
    if (metadata.mediaType !== ref.mediaType || metadata.width !== ref.width || metadata.height !== ref.height) {
      throw new AttachmentError('附件元数据不匹配', 'ATTACHMENT_CORRUPT')
    }
    return data
  }

  async #metadata(data: Uint8Array): Promise<{ mediaType: ImageAttachmentRef['mediaType']; width: number; height: number }> {
    let metadata: SharpMetadata
    try { metadata = await sharp(data, { failOn: 'error' }).metadata() }
    catch (error) { throw new AttachmentError(`图片解码失败：${String(error)}`, 'ATTACHMENT_DECODE_FAILED') }
    const mediaType = metadata.format === undefined ? undefined : formatToMedia.get(metadata.format)
    if (mediaType === undefined || metadata.width === undefined || metadata.height === undefined) {
      throw new AttachmentError('图片格式或尺寸无效', 'ATTACHMENT_DECODE_FAILED')
    }
    return { mediaType, width: metadata.width, height: metadata.height }
  }
}
