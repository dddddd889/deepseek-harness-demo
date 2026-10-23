import { Database } from 'bun:sqlite'
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate'

/** 搜索索引是可重建读模型，不是Session日志后端。 */
export class Query {
  constructor(path) {
    this.db = new Database(path)
    this.db.exec('CREATE TABLE IF NOT EXISTS indexed(session TEXT PRIMARY KEY, seq INTEGER); CREATE VIRTUAL TABLE IF NOT EXISTS content USING fts5(session UNINDEXED, seq UNINDEXED, text);')
  }
  /** 接收冷读快照，不创建/激活Agent。 */
  index(sessionId, events) {
    const previous = this.db.prepare('SELECT seq FROM indexed WHERE session=?').get(sessionId)?.seq ?? -1
    this.db.exec('BEGIN IMMEDIATE')
    try {
      for (const event of events.filter(event => event.seq > previous && event.type.startsWith('message/'))) this.db.prepare('INSERT INTO content(session,seq,text) VALUES(?,?,?)').run(sessionId, event.seq, JSON.stringify(event.data))
      this.db.prepare('INSERT INTO indexed(session,seq) VALUES(?,?) ON CONFLICT(session) DO UPDATE SET seq=excluded.seq').run(sessionId, events.at(-1)?.seq ?? -1)
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  search(query, allowedSessions, limit = 20) {
    // 将用户输入作为短语，禁止把它拼成任意FTS表达式或SQL。
    const phrase = '"' + query.replaceAll('"', '""') + '"'
    return this.db.prepare('SELECT session,seq,text FROM content WHERE content MATCH ? ORDER BY rank LIMIT ?').all(phrase, Math.min(limit, 100)).filter(row => allowedSessions.has(row.session))
  }
  close() { this.db.close() }
}

/** ZIP只导出调用方已授权的事实，不打包home里的凭据。 */
export function exportSession(header, events) {
  return zipSync({ 'manifest.json': strToU8(JSON.stringify({ format: 'harness-own-export-v1', header })), 'events.json': strToU8(JSON.stringify(events)) })
}

/** 全部校验后才交给导入器；压缩炸弹和路径跳转在解压前拒绝。 */
export function importSession(bytes) {
  let invalid = false, total = 0
  const files = unzipSync(bytes, { filter: file => {
    total += file.originalSize
    if (!['manifest.json', 'events.json'].includes(file.name) || total > 20 * 1024 * 1024) { invalid = true; return false }
    return true
  } })
  if (invalid || !files['manifest.json'] || !files['events.json']) throw Error('会话ZIP不合法')
  const manifest = JSON.parse(strFromU8(files['manifest.json'])), events = JSON.parse(strFromU8(files['events.json']))
  if (manifest.format !== 'harness-own-export-v1' || !Array.isArray(events) || events.some((event, index) => event.format !== 1 || event.seq !== index)) throw Error('不支持的会话格式')
  return { header: manifest.header, events }
}
