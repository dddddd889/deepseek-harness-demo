import { Plugins } from './plugins.mjs'
import { Store } from './storage.mjs'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

/** 市场索引是数据，不因为远端声称有插件就自动执行包内代码。 */
export function marketIndex(manifests) {
  return manifests.filter(manifest => manifest.name && manifest.version && manifest.harness?.entry)
    .map(manifest => ({ name: manifest.name, version: manifest.version, description: manifest.description ?? '', entry: manifest.harness.entry }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** 显式安装可信本地插件，只有setup成功后才提交启用状态。 */
export class PluginManager {
  constructor(path) { this.store = new Store(path); this.runtime = new Plugins() }
  async enable(name, file, config = {}) {
    const module = await import(pathToFileURL(resolve(file)).href + '?generation=' + Date.now())
    if (typeof module.setup !== 'function') throw Error('插件缺少setup')
    await this.runtime.install(name, context => module.setup(context, config))
    this.store.update(value => ({ ...value, [name]: { file: resolve(file), config, enabled: true } }))
  }
  async disable(name) { await this.runtime.remove(name); this.store.update(value => { if (value[name]) value[name].enabled = false; return value }) }
  async restore() { for (const [name, row] of Object.entries(this.store.read())) if (row.enabled) await this.enable(name, row.file, row.config) }
  async close() { await this.runtime.close() }
}
