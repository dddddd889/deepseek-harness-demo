import { Store } from '../src/storage.mjs'

/** 快捷键配置保持最后接受版本；坏文件不自动覆盖成默认值。 */
export class Shortcuts {
  constructor(path) { this.store = new Store(path) }
  read() {
    const value = this.store.read()
    if (value.version !== undefined && value.version !== 1) throw Error('未知快捷键版本，拒绝改写')
    return value.bindings ?? { send: 'CommandOrControl+Enter', cancel: 'Escape' }
  }
  write(bindings) {
    this.read()
    if (Object.values(bindings).some(value => typeof value !== 'string') || new Set(Object.values(bindings)).size !== Object.values(bindings).length) throw Error('快捷键重复或不合法')
    this.store.update(() => ({ version: 1, bindings }))
  }
}
