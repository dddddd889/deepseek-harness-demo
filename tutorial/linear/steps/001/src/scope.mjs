/** 作用域拥有资源；关掉它时逆序清理，重复关闭不会重复执行。 */
export class Scope {
  disposers = []
  closed = false
  /** 记录资源归属，返回单次撤销函数。 */
  own(dispose) {
    if (this.closed) throw new Error('作用域已关闭')
    let active = true
    const once = async () => {
      if (!active) return
      active = false
      const index = this.disposers.indexOf(once)
      if (index >= 0) this.disposers.splice(index, 1)
      await dispose()
    }
    this.disposers.push(once)
    return once
  }
  /** 子作用域的退出属于父作用域，子资源先清。 */
  child() {
    const child = new Scope()
    const release = this.own(() => child.close())
    child.own(() => release())
    return child
  }
  /** 一个清理失败也继续清其他资源，最后汇总错误。 */
  async close() {
    if (this.closed) return
    this.closed = true
    const errors = []
    for (const dispose of this.disposers.splice(0).reverse()) {
      try { await dispose() } catch (error) { errors.push(error) }
    }
    this.disposers = []
    if (errors.length) throw new AggregateError(errors, '资源清理失败')
  }
}
