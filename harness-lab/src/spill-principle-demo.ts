import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

interface DemoSpillRef {
  readonly id: string
  readonly bytes: number
  readonly sha256: string
}

interface DemoPage {
  readonly text: string
  readonly startOffset: number
  readonly nextOffset?: number
}

/** 教学版存储只保留四个核心原则：私有目录、先写后引用、内容摘要和有界读取。 */
class SimpleSpillStore {
  readonly #root: string

  constructor(root: string) {
    this.#root = resolve(root, 'objects')
  }

  /** 先把内容完整刷入临时文件，再原子发布最终对象和引用。 */
  async saveText(content: string): Promise<DemoSpillRef> {
    const data = Buffer.from(content, 'utf8')
    const sha256 = createHash('sha256').update(data).digest('hex')
    const directory = join(this.#root, sha256.slice(0, 2))
    const finalPath = join(directory, sha256)
    const temporaryPath = join(directory, `.${sha256}.${randomUUID()}.tmp`)
    await mkdir(directory, { recursive: true, mode: 0o700 })

    const handle = await open(temporaryPath, 'wx', 0o600)
    try {
      await handle.writeFile(data)
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporaryPath, finalPath)

    return { id: `spill:sha256:${sha256}`, bytes: data.byteLength, sha256 }
  }

  /** 按字节窗口读取，证明外置内容不需要一次全部回到模型可见面。 */
  async readPage(ref: DemoSpillRef, offset: number, limit: number): Promise<DemoPage> {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit <= 0) {
      throw new Error('分页参数必须是有效的正整数')
    }
    const length = Math.min(limit, Math.max(0, ref.bytes - offset))
    const buffer = Buffer.alloc(length)
    const handle = await open(this.#path(ref), 'r')
    try {
      const { bytesRead } = await handle.read(buffer, 0, length, offset)
      const endOffset = offset + bytesRead
      return {
        text: buffer.subarray(0, bytesRead).toString('utf8'),
        startOffset: offset,
        ...(endOffset < ref.bytes ? { nextOffset: endOffset } : {}),
      }
    } finally {
      await handle.close()
    }
  }

  /** 冷读取重新校验长度与摘要，损坏内容不能静默进入模型。 */
  async verify(ref: DemoSpillRef): Promise<void> {
    const data = await readFile(this.#path(ref))
    const actual = createHash('sha256').update(data).digest('hex')
    if (data.byteLength !== ref.bytes || actual !== ref.sha256) throw new Error('Spill 完整性校验失败')
  }

  /** 仅供 Demo 制造磁盘篡改，真实 Store 不应暴露这个方法。 */
  async corruptForDemo(ref: DemoSpillRef): Promise<void> {
    await writeFile(this.#path(ref), '内容已被篡改', 'utf8')
  }

  /** 不透明标识只能由 Store 解析，调用方不能提供任意磁盘路径。 */
  #path(ref: DemoSpillRef): string {
    const match = /^spill:sha256:([a-f0-9]{64})$/.exec(ref.id)
    if (match?.[1] === undefined || match[1] !== ref.sha256) throw new Error('Spill 引用无效')
    return join(this.#root, match[1].slice(0, 2), match[1])
  }
}

/** 小内容直接内联，大内容只返回预览和稳定引用。 */
async function inlineOrSpill(store: SimpleSpillStore, content: string, thresholdBytes: number): Promise<{
  readonly modelText: string
  readonly ref?: DemoSpillRef
}> {
  const bytes = Buffer.byteLength(content, 'utf8')
  if (bytes <= thresholdBytes) return { modelText: content }
  const ref = await store.saveText(content)
  return {
    modelText: `${content.slice(0, 32)}……\n[完整内容已外置，共 ${bytes} 字节，引用：${ref.id}]`,
    ref,
  }
}

/** 依次演示触发、提交引用、分页回读和篡改检测。 */
async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'spill-principle-demo-'))
  try {
    const store = new SimpleSpillStore(root)

    console.log('\n一、小内容直接内联')
    const small = await inlineOrSpill(store, '简短工具结果', 64)
    console.log(small)
    assert.equal(small.ref, undefined)

    console.log('\n二、大内容先落盘，再把引用写入会话事件')
    const largeContent = Array.from({ length: 12 }, (_, index) =>
      `line-${String(index + 1).padStart(2, '0')}: ${'x'.repeat(16)}\n`).join('')
    const large = await inlineOrSpill(store, largeContent, 64)
    assert.ok(large.ref)
    const sessionEvent = {
      type: 'tool/result',
      data: { preview: large.modelText, spillRef: large.ref },
    }
    console.dir(sessionEvent, { depth: null })

    console.log('\n三、模型按固定窗口分页读取，不一次加载完整内容')
    let offset = 0
    let pageNumber = 1
    while (true) {
      const page = await store.readPage(large.ref, offset, 48)
      console.log(`第 ${pageNumber} 页，字节 ${page.startOffset}–${page.nextOffset ?? large.ref.bytes}：`)
      console.log(page.text)
      if (page.nextOffset === undefined) break
      offset = page.nextOffset
      pageNumber += 1
    }

    console.log('\n四、冷读取先验证完整性')
    await store.verify(large.ref)
    console.log('完整性校验：通过')

    console.log('\n五、篡改后必须明确失败')
    await store.corruptForDemo(large.ref)
    await assert.rejects(store.verify(large.ref), /Spill 完整性校验失败/)
    console.log('完整性校验：Spill 完整性校验失败')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

if (import.meta.main) await main()
