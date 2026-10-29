import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

/** 持久产品数据与Session事实分开存；写入使用临时文件+原子替换。 */
export class Store {
  constructor(path) { this.path = path; mkdirSync(dirname(path), { recursive: true }) }
  read() { try { return JSON.parse(readFileSync(this.path, 'utf8')) } catch (error) { if (error.code === 'ENOENT') return {}; throw error } }
  update(change) { const value = change(this.read()), temporary = this.path + '.' + randomUUID(); writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 }); renameSync(temporary, this.path); return value }
}

/** CredentialRef对UI可见，明文Key只在宿主提供方调用前解析。 */
export class Credentials {
  constructor(path) { this.store = new Store(path) }
  set(name, secret) { if (typeof secret !== 'string' || !secret) throw Error('凭据为空'); this.store.update(value => ({ ...value, [name]: secret })); return { ref: name, configured: true } }
  list() { return Object.keys(this.store.read()).map(ref => ({ ref, configured: true })) }
  resolve(ref) { const value = this.store.read()[ref] ?? process.env[ref]; if (!value) throw Error('缺少凭据：' + ref); return value }
  remove(ref) { this.store.update(value => { delete value[ref]; return value }) }
}

/** 工作区是持久实体；有效cwd不再是一个全局常量。 */
export class Workspaces {
  constructor(path) { this.store = new Store(path) }
  add(path, title) { const id = randomUUID(); this.store.update(value => ({ ...value, [id]: { id, path: resolve(path), title, archived: false } })); return id }
  list() { return Object.values(this.store.read()) }
  update(id, patch) { this.store.update(value => { if (!value[id]) throw Error('未知工作区'); value[id] = { ...value[id], title: patch.title ?? value[id].title, archived: patch.archived ?? value[id].archived }; return value }) }
}
