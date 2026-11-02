import { execute } from './process.mjs'
import { resolve, relative, join } from 'node:path'
import { mkdir, writeFile, rename } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'

/** 只管理自己创建的worktree；删除前留普通文件归档，不自动git commit。 */
export class Worktrees {
  owned = new Map()
  constructor(repository, root) { this.repository = resolve(repository); this.root = resolve(root) }
  async create(name, reference, signal) {
    if (!/^[a-z][a-z0-9-]{0,40}$/.test(name) || typeof reference !== 'string' || reference.startsWith('-')) throw Error('worktree名称/ref不合法')
    const target = join(this.root, name); await mkdir(this.root, { recursive: true })
    const result = await execute({ command: 'git', args: ['-C', this.repository, 'worktree', 'add', '--detach', target, reference], timeout: 60_000 }, signal)
    if (result.code) throw Error('worktree创建失败：' + result.output)
    this.owned.set(name, target); return target
  }
  async archive(name, destination, signal) {
    const target = this.owned.get(name)
    if (!target) throw Error('不是本管理器拥有的worktree')
    const files = await execute({ command: 'git', args: ['-C', target, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], maxBytes: 1024 * 1024 }, signal)
    if (files.code) throw Error('worktree枚举失败')
    const list = destination + '.files-' + randomUUID(), staging = destination + '.staging'
    // 清单使用NUL分隔，路径有空格/换行时也不改变tar参数语义。
    await writeFile(list, files.output)
    const packed = await execute({ command: 'tar', args: ['-czf', staging, '-C', target, '--null', '-T', list], timeout: 60_000 }, signal)
    if (packed.code) throw Error('worktree归档失败')
    await rename(staging, destination)
    const removed = await execute({ command: 'git', args: ['-C', this.repository, 'worktree', 'remove', '--force', target] }, signal)
    if (removed.code) throw Error('已归档但worktree未删除：' + removed.output)
    this.owned.delete(name)
    return { archive: destination, meaning: '保留tracked和非ignored文件；未创建提交，ignored文件需另行保留。' }
  }
}
