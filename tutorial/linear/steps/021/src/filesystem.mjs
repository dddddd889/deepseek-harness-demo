import { realpath, readFile, writeFile, rename, mkdir, stat } from 'node:fs/promises'
import { resolve, relative, dirname, basename, join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

/** 路径接纳与文件执行是一个可替换提供方，不混进模型或 Loop。 */
export class LocalFS {
  constructor(root) { this.root = resolve(root); this.observed = new Map() }
  /** 同时检查词法路径与已存在祖先的真实路径。 */
  async path(name) {
    const root = await realpath(this.root), target = resolve(root, name)
    const inside = value => { const rel = relative(root, value); if (rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || resolve(root, rel) !== value) throw Error('越出工作区') }
    inside(target)
    let ancestor = target
    for (;;) {
      try { inside(await realpath(ancestor)); break }
      catch (error) { if (error.code !== 'ENOENT') throw error; const parent = dirname(ancestor); if (parent === ancestor) throw error; ancestor = parent }
    }
    return target
  }
  /** 读取时记录实际内容指纹，后续编辑必须基于这份 observed version。 */
  async read(name) {
    const path = await this.path(name), bytes = await readFile(path)
    const version = createHash('sha256').update(bytes).digest('hex')
    this.observed.set(path, version)
    return { text: bytes.toString('utf8'), version }
  }
  /** 同进程编辑串行化；跨进程 CAS 需要由更强文件提供方保证。 */
  pending = Promise.resolve()
  write(name, text, expected = undefined) {
    const operation = this.pending.then(async () => {
      const path = await this.path(name)
      let current
      try { current = createHash('sha256').update(await readFile(path)).digest('hex') } catch (error) { if (error.code !== 'ENOENT') throw error }
      if (current !== undefined && (!expected || expected !== current || this.observed.get(path) !== current)) throw Error('文件已变化或尚未读取')
      if (current === undefined && expected !== undefined) throw Error('文件已被删除')
      await mkdir(dirname(path), { recursive: true })
      const temporary = join(dirname(path), '.' + basename(path) + '.' + randomUUID())
      await writeFile(temporary, text, { mode: 0o600, flag: 'wx' })
      await rename(temporary, path)
      this.observed.delete(path) // 每次修改后必须重新观察。
      return { bytes: Buffer.byteLength(text) }
    })
    this.pending = operation.catch(() => {})
    return operation
  }
}
