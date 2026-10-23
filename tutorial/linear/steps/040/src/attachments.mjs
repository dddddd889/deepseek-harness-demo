import { mkdir, writeFile, readFile, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { execute } from './process.mjs'

/** 附件先持久化再把引用写入用户消息；下载还需要Host授权。 */
export class Attachments {
  constructor(root, maxBytes = 20 * 1024 * 1024) { this.root = root; this.maxBytes = maxBytes }
  async save(bytes, mediaType) {
    if (bytes.length > this.maxBytes || bytes.length === 0) throw Error('附件大小不合法')
    const id = createHash('sha256').update(bytes).digest('hex')
    await mkdir(this.root, { recursive: true })
    try { await writeFile(join(this.root, id), bytes, { flag: 'wx', mode: 0o600 }) } catch (error) { if (error.code !== 'EEXIST') throw error }
    return { id, mediaType, bytes: bytes.length }
  }
  async read(ref) {
    if (!/^[a-f0-9]{64}$/.test(ref.id)) throw Error('附件身份不合法')
    const bytes = await readFile(join(this.root, ref.id))
    if (createHash('sha256').update(bytes).digest('hex') !== ref.id) throw Error('附件完整性错误')
    return bytes
  }
}

/** 外部Office转换器的真实进程适配；没有软件就失败，不能用改后缀伪造PDF。 */
export async function officeToPDF(input, outputDirectory, signal, command = 'libreoffice') {
  const result = await execute({ command, args: ['--headless', '--convert-to', 'pdf', '--outdir', outputDirectory, input], timeout: 60_000 }, signal)
  if (result.code !== 0) throw Error('文档转换失败：' + result.output)
  return result
}

/** 交付保存内容快照与hash，后续文件变化不改变这个turn的交付事实。 */
export async function present(session, store, path, mediaType) {
  const ref = await store.save(await readFile(path), mediaType)
  session.append('deliverable', { path, ref })
  return ref
}
