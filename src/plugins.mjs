import { Scope } from './scope.mjs'
import { Services } from './services.mjs'

/** Loader 将数据配置装配为可撤销的插件树。 */
export class Plugins {
	constructor() { this.scope = new Scope(); this.services = new Services(); this.active = new Map() }
	/** 先检查依赖，再安装；失败要撤销半成品。 */
	async install(name, setup) {
		if (this.active.has(name)) throw Error('重复插件：' + name)
		const scope = this.scope.child()
		try {
			await setup({ scope, services: this.services })
			this.active.set(name, scope)
		} catch (error) {
			try { await scope.close() } catch (cleanup) { throw new AggregateError([error, cleanup]) }
			throw error
		}
	}
	/** 只撤销目标贡献，其他插件不受影响。 */
	async remove(name) { const scope = this.active.get(name); this.active.delete(name); await scope?.close() }
	/** Profile 顺序固定；任一配置失败，撤销本次装配。 */
	async profile(rows, catalog) {
		const installed = []
		try {
			for (const row of rows) {
				if (row.enabled === false) continue
				if (!catalog[row.name]) throw Error('未知插件：' + row.name)
				await this.install(row.name, context => catalog[row.name](context, row.config ?? {}))
				installed.push(row.name)
			}
		} catch (error) { for (const name of installed.reverse()) await this.remove(name); throw error }
	}
	/** 应用退出等待所有资源。 */
	async close() { await this.scope.close(); this.active.clear() }
}