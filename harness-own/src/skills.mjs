import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

/** 固定用户层→项目层优先级，目录发现与按需加载分开。 */
export class Skills {
  constructor(roots) { this.roots = roots; this.catalog = new Map() }
  /** 只发现命名目录；同名后层覆盖前层。 */
  async discover() {
    this.catalog.clear()
    for (const root of this.roots) {
      let entries
      try { entries = await readdir(root, { withFileTypes: true }) } catch (error) { if (error.code === 'ENOENT') continue; throw error }
      for (const entry of entries.filter(entry => entry.isDirectory())) this.catalog.set(entry.name, join(root, entry.name, 'SKILL.md'))
    }
    return [...this.catalog.keys()].sort()
  }
  /** 加载来源、内容hash与正文一起入事实，历史请求可以解释。 */
  async load(name, session) {
    const path = this.catalog.get(name)
    if (!path) throw Error('未知Skill')
    const content = await readFile(path, 'utf8'), hash = createHash('sha256').update(content).digest('hex')
    session.append('context/skill', { name, path, hash, content })
    return content
  }
}

/** 规则也作为请求输入事实记录，不在历史回放时偷偷重新读新文件。 */
export async function instructions(path, session) {
  let content = ''
  try { content = await readFile(path, 'utf8') } catch (error) { if (error.code !== 'ENOENT') throw error }
  session.append('context/instructions', { path, content })
  return content
}