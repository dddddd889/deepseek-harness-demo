import { mkdirSync, writeFileSync, readFileSync, renameSync, existsSync, openSync, closeSync, fsyncSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

/** 通过不可变代次和原子指针发布迁移/快照；旧文件不原地重写。 */
export class Generations {
  constructor(root) { this.root = root; mkdirSync(root, { recursive: true }) }
  /** 先完整落盘代次，再发布指针；故障注入位于两者之间。 */
  publish(value, beforePublish = () => {}) {
    const name = randomUUID() + '.json', target = join(this.root, name)
    writeFileSync(target, JSON.stringify(value))
    const file = openSync(target, 'r'); try { fsyncSync(file) } finally { closeSync(file) }
    beforePublish()
    const temporary = join(this.root, 'current.' + randomUUID())
    writeFileSync(temporary, name)
    renameSync(temporary, join(this.root, 'current'))
    // POSIX 目录 fsync；不在 Windows 冒充同样的耐久保证。
    if (process.platform !== 'win32') { const directory = openSync(this.root, 'r'); try { fsyncSync(directory) } finally { closeSync(directory) } }
    return name
  }
  /** 没有指针就没有已发布代次；孤立文件不自行成为当前状态。 */
  read() {
    const pointer = join(this.root, 'current')
    if (!existsSync(pointer)) return undefined
    const name = readFileSync(pointer, 'utf8')
    if (!/^[a-f0-9-]+\.json$/.test(name)) throw Error('代次指针不合法')
    return JSON.parse(readFileSync(join(this.root, name), 'utf8'))
  }
  /** 相邻迁移逐次执行，拒绝缺链与未知未来格式。 */
  migrate(target, migrations) {
    let value = this.read()
    if (!value || value.version > target) throw Error('不支持的格式')
    while (value.version < target) {
      const from = value.version, migration = migrations[from]
      if (!migration) throw Error('缺迁移：' + from)
      value = migration(structuredClone(value))
      if (value.version !== from + 1) throw Error('迁移必须相邻')
    }
    this.publish(value)
    return value
  }
}