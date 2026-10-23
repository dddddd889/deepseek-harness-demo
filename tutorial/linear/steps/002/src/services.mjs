/** 服务接口与实现解耦，注册项带身份，旧撤销不能误删后注册项。 */
export class Services {
  entries = new Map()
  constructor(parent = undefined) { this.parent = parent }
  /** 在当前作用域注册，允许子作用域覆盖父服务。 */
  provide(scope, name, value) {
    if (this.entries.has(name)) throw Error('重复服务：' + name)
    const entry = { value }
    this.entries.set(name, entry)
    scope.own(() => { if (this.entries.get(name) === entry) this.entries.delete(name) })
    return value
  }
  /** 消费方只拿契约，缺依赖立即失败，不能默默使用全局对象。 */
  get(name) {
    if (this.entries.has(name)) return this.entries.get(name).value
    if (this.parent) return this.parent.get(name)
    throw Error('缺少服务：' + name)
  }
  /** 创建会话私有的覆盖层。 */
  child() { return new Services(this) }
}
