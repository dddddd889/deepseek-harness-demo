import { createHash } from 'node:crypto'
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

/** 大结果保存原文，模型看短摘要和可校验定位。 */
export class Spill {
  constructor(root) { this.root = root; mkdirSync(root, { recursive: true }) }
  put(text) { const id = createHash('sha256').update(text).digest('hex'); writeFileSync(join(this.root, id), text); return { id, bytes: Buffer.byteLength(text), preview: text.slice(0, 256) } }
  get(id) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw Error('Spill 身份不合法')
    const text = readFileSync(join(this.root, id), 'utf8')
    if (createHash('sha256').update(text).digest('hex') !== id) throw Error('Spill 完整性错误')
    return text
  }
}

/** 压缩作用于模型可见副本；日志仍保留完整工具组与请求事实。 */
export async function compact(history, { limit, measure, summarize, signal }) {
  const copy = structuredClone(history)
  if (measure(copy) <= limit) return copy
  // 从最后一条 user 开始保留当前 turn，工具调用与结果不拆开。
  let split = copy.length - 1
  while (split > 0 && copy[split].role !== 'user') split--
  const recent = copy.slice(split)
  if (split === 0 || measure(recent) > limit) throw Error('当前轮次本身超限')
  signal.throwIfAborted()
  const summary = await summarize(copy.slice(0, split), signal)
  const result = [{ role: 'user', content: '此前工作摘要：' + summary }, ...recent]
  if (measure(result) > limit) throw Error('摘要后仍超限')
  return result
}