import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'

export interface SkillSummary {
  readonly name: string
  readonly description: string
  readonly provider: string
  readonly rank: number
  readonly modelInvocable: boolean
  readonly userInvocable: boolean
  readonly resourceBase: string
}

export interface SkillDefinition extends SkillSummary {
  readonly content: string
  readonly path: string
}

interface Candidate extends SkillSummary { readonly path: string }

/** 解析课程所需的严格 frontmatter 子集，未知字段保留为无害元数据外信息。 */
function parseSkill(markdown: string, fallbackName: string): { name: string; description: string; modelInvocable: boolean; userInvocable: boolean; content: string } {
  if (!markdown.startsWith('---\n')) throw new Error('SKILL.md 缺少 YAML frontmatter')
  const end = markdown.indexOf('\n---\n', 4)
  if (end < 0) throw new Error('SKILL.md frontmatter 未闭合')
  const fields = new Map<string, string>()
  for (const line of markdown.slice(4, end).split('\n')) {
    const colon = line.indexOf(':')
    if (colon > 0) fields.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim().replace(/^['"]|['"]$/g, ''))
  }
  const name = fields.get('name') ?? fallbackName
  const description = fields.get('description') ?? ''
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) throw new Error(`skill 名称无效：${name}`)
  if (description === '') throw new Error(`skill ${name} 缺少 description`)
  return {
    name,
    description,
    modelInvocable: fields.get('model-invocable') !== 'false',
    userInvocable: fields.get('user-invocable') !== 'false',
    content: markdown.slice(end + 5),
  }
}

/** 文件系统 Skills：低 rank 胜出，list 不加载正文，get 才读取最新内容。 */
export class SkillRegistry {
  readonly #roots: readonly { readonly path: string; readonly rank: number; readonly provider: string }[]
  readonly #winners = new Map<string, Candidate>()

  constructor(roots: readonly { readonly path: string; readonly rank: number; readonly provider: string }[]) {
    this.#roots = roots.map(root => ({ ...root, path: resolve(root.path) }))
  }

  async refresh(): Promise<void> {
    const candidates: Candidate[] = []
    for (const root of this.#roots) candidates.push(...await this.#scanRoot(root))
    candidates.sort((left, right) => left.rank - right.rank || left.name.localeCompare(right.name))
    this.#winners.clear()
    for (const candidate of candidates) if (!this.#winners.has(candidate.name)) this.#winners.set(candidate.name, candidate)
  }

  list(view: 'model' | 'user' = 'model'): readonly SkillSummary[] {
    return [...this.#winners.values()]
      .filter(skill => view === 'model' ? skill.modelInvocable : skill.userInvocable)
      .map(({ path: _path, ...summary }) => summary)
      .sort((left, right) => left.name.localeCompare(right.name))
  }

  async get(name: string, view: 'model' | 'user' = 'model'): Promise<SkillDefinition | undefined> {
    const candidate = this.#winners.get(name)
    if (candidate === undefined || (view === 'model' ? !candidate.modelInvocable : !candidate.userInvocable)) return undefined
    const markdown = await readFile(candidate.path, 'utf8')
    const parsed = parseSkill(markdown, candidate.name)
    return { ...candidate, ...parsed, path: candidate.path }
  }

  /** 渲染时明确资源基址，模型才能安全解析相对引用。 */
  render(skill: SkillDefinition): string {
    return `<skill_content name="${skill.name}">\n<skill_resources>\nBase directory: ${skill.resourceBase}\n</skill_resources>\n<skill_instructions>\n${skill.content}\n</skill_instructions>\n</skill_content>`
  }

  async #scanRoot(root: { readonly path: string; readonly rank: number; readonly provider: string }): Promise<Candidate[]> {
    let entries
    try { entries = await readdir(root.path, { withFileTypes: true }) } catch { return [] }
    const rootReal = await realpath(root.path)
    const output: Candidate[] = []
    for (const entry of entries) {
      const path = entry.isDirectory() ? join(root.path, entry.name, 'SKILL.md')
        : entry.isFile() && extname(entry.name) === '.md' ? join(root.path, entry.name) : undefined
      if (path === undefined) continue
      try {
        if (!(await stat(path)).isFile()) continue
        const resolved = await realpath(path)
        const inside = relative(rootReal, resolved)
        if (inside === '..' || inside.startsWith(`..${sep}`)) continue
        const fallback = entry.isDirectory() ? entry.name : basename(entry.name, '.md')
        const parsed = parseSkill(await readFile(resolved, 'utf8'), fallback)
        output.push({
          name: parsed.name, description: parsed.description,
          modelInvocable: parsed.modelInvocable, userInvocable: parsed.userInvocable,
          provider: root.provider, rank: root.rank, path: resolved, resourceBase: dirname(resolved),
        })
      } catch { /* 单个坏 skill 不污染其余目录发现。 */ }
    }
    return output
  }
}
