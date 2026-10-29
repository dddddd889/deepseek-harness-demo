/** 配置改变影响下一请求；快照不得被调用方或后续热更新修改。 */
export class Settings {
  constructor(initial = {}) { this.value = structuredClone(initial); this.revision = 0 }
  /** 提交新版本，数组/对象均复制，不共享可变引用。 */
  set(patch) { this.value = { ...this.value, ...structuredClone(patch) }; this.revision++ }
  /** 用序列化边界获得深副本，冻结所有嵌套属性。 */
  snapshot() {
    const freeze = value => {
      if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
      return value
    }
    return freeze({ revision: this.revision, ...structuredClone(this.value) })
  }
}

/** Bundle 基础层、机器层、Profile 层顺序合并，不执行配置里的代码。 */
export function compose(...layers) {
  const rows = new Map()
  for (const layer of layers) for (const row of layer) {
    if (!row.id || !row.name) throw Error('配置缺少 id/name')
    rows.set(row.id, { ...rows.get(row.id), ...structuredClone(row) })
  }
  return [...rows.values()]
}