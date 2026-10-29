import { openSync, writeSync, fsyncSync, closeSync, readFileSync, ftruncateSync, unlinkSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

/** 这是本工程的格式 v1；不能把它谎称为原版 Session V4。 */
export class Journal {
  closed = false
  /** 用独占锁阻止双写，崩溃锁需要明确核验 owner 后处理。 */
  constructor(path) {
    mkdirSync(dirname(path), { recursive: true })
    this.path = path
    this.lock = path + '.lock'
    const lock = openSync(this.lock, 'wx')
    try { writeSync(lock, JSON.stringify({ pid: process.pid, nonce: randomUUID() })); fsyncSync(lock) }
    finally { closeSync(lock) }
    try {
      this.fd = openSync(path, 'a+')
      const buffer = readFileSync(path), last = buffer.lastIndexOf(10)
      // 只有未完成的最后一行可以修复，中间坏行必须报错。
      const committed = buffer.subarray(0, last + 1).toString('utf8')
      this.records = committed.split('\n').filter(Boolean).map(line => JSON.parse(line))
      this.records.forEach((record, index) => {
        if (record.seq !== index || record.format !== 1) throw Error('日志序号或格式不合法')
      })
      if (last + 1 < buffer.length) { ftruncateSync(this.fd, last + 1); fsyncSync(this.fd) }
    } catch (error) { if (this.fd !== undefined) closeSync(this.fd); unlinkSync(this.lock); throw error }
  }
  /** 同步追加边界让后续副作用知道持久化是否成功。 */
  append(record) {
    if (this.closed) throw Error('日志已关闭')
    if (record.seq !== this.records.length) throw Error('日志序号冲突')
    const bytes = Buffer.from(JSON.stringify(record) + '\n')
    let offset = 0
    while (offset < bytes.length) offset += writeSync(this.fd, bytes, offset)
    fsyncSync(this.fd)
    this.records.push(structuredClone(record))
  }
  /** 正常退出释放文件与独占锁。 */
  close() { if (this.closed) return; this.closed = true; closeSync(this.fd); unlinkSync(this.lock) }
}