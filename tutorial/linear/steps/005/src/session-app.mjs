import { appendFileSync, closeSync, fsyncSync, mkdirSync, openSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { Plugins } from './plugins.mjs'
import { Settings, compose } from './config.mjs'
import { Events, id } from './events.mjs'

/** 把000～004的基础件装成一次真实读文件任务；模型循环在后续章节接入。 */
export async function createReaderApp({ logPath, display = () => {}, layers = [] }) {
  if (!logPath) throw Error('需要明确指定会话日志路径')
  const plugins = new Plugins() // 当前应用只有一个插件管理根。
  const rows = [ // 顺序体现真实依赖：读任务依赖设置和会话，终端依赖会话。
    { id: 'settings', name: 'settings', config: { prefix: '读取完成' } },
    { id: 'session', name: 'session' },
    { id: 'terminal', name: 'terminal' },
    { id: 'reader', name: 'reader' }
  ]
  const catalog = {
    /** 设置插件：提供所有任务共享的最新设置入口。 */
    settings({ scope, services }, config) {
      services.provide(scope, 'settings', new Settings(config))
    },
    /** 会话插件：本步使用最小JSONL写入器，第006步的Journal提供恢复与损坏处理，本例尚未接入。 */
    session({ scope, services }) {
      const path = resolve(logPath) // 一个新文件只属于这一个会话。
      mkdirSync(dirname(path), { recursive: true })
      const descriptor = openSync(path, 'ax', 0o600) // 已存在就失败，禁止混入旧会话。
      scope.own(() => closeSync(descriptor)) // 先登记文件关闭，后登记服务撤销。
      const session = new Events(id('session'), record => {
        appendFileSync(descriptor, JSON.stringify(record) + '\n')
        fsyncSync(descriptor) // 写入返回后才允许提交内存与通知观察者。
      })
      services.provide(scope, 'session', session)
    },
    /** 终端插件：只订阅事实，自己的卸载不应停止业务或删除历史。 */
    terminal({ scope, services }) {
      const session = services.get('session') // 从共享注册表获取会话。
      scope.own(session.on(display)) // on返回取消订阅函数，归本插件Scope管理。
    },
    /** 任务插件：写事实并执行文件读取，不直接调用终端显示函数。 */
    reader({ scope, services }) {
      const session = services.get('session'), settings = services.get('settings')
      let active, controller // 本步只运行一个任务，队列与并发在后面实现。
      services.provide(scope, 'readTask', {
        /** 每次任务只取一次配置快照；所有事件带同一个turnId关联。 */
        run(path) {
          if (scope.closed) return Promise.reject(Error('读任务插件已退出'))
          if (active) return Promise.reject(Error('已有读任务正在执行'))
          const config = settings.snapshot(), turnId = id('turn'), callId = id('call')
          const request = new AbortController() // 退出插件时取消当前文件读取。
          controller = request
          active = Promise.resolve().then(async () => {
            request.signal.throwIfAborted()
            session.append('turn/start', { turnId, config })
            session.append('message/user', { role: 'user', content: '读取 ' + path })
            session.append('tool/start', { turnId, callId, name: 'read', path })
            let text // 只有真实文件读取成功才产生tool/end和最终消息。
            try { text = await readFile(path, { encoding: 'utf8', signal: request.signal }) }
            catch (error) {
              session.append('tool/error', { turnId, callId, message: error.message })
              session.append('turn/end', { turnId, reason: request.signal.aborted ? 'cancelled' : 'error' })
              throw error
            }
            session.append('tool/end', { turnId, callId, text })
            const content = config.prefix + '：\n' + text // 本步直接展示文件结果，不伪装成模型生成。
            session.append('message/assistant', { role: 'assistant', content })
            session.append('turn/end', { turnId, reason: 'completed' })
            return { turnId, config, content }
          })
          return active.finally(() => { active = undefined; controller = undefined })
        }
      })
      // 后登记的任务退出先执行：先取消并等待读取收敛，再让会话插件关闭日志。
      scope.own(async () => { controller?.abort(Error('读任务插件退出')); if (active) await active.catch(() => {}) })
    }
  }
  try {
    await plugins.profile(compose(rows, ...layers), catalog) // 合并配置后才安装，而不是只测试compose函数。
    return plugins
  } catch (error) {
    try { await plugins.close() } catch (cleanup) { throw new AggregateError([error, cleanup], '应用装配失败') }
    throw error
  }
}
