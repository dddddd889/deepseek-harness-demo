import { resolve } from 'node:path'
import { input } from './main.mjs'
import { id } from './events.mjs'
import { createReaderApp } from './session-app.mjs'

// 沿用第000步的输入校验；这里只读取用户明确指定的文件。
const path = input(process.argv.slice(2))
const logPath = resolve('.data-005', id('session') + '.jsonl') // 每次运行生成独立日志，不覆盖旧记录。
const app = await createReaderApp({
  logPath,
  display(event) {
    console.log('[终端]', event.seq, event.type)
    if (event.type === 'message/assistant') console.log(event.data.content)
  },
  layers: [[{ id: 'settings', name: 'settings', config: { prefix: '本次任务的文件内容' } }]]
})

try {
  const session = app.services.get('session'), task = app.services.get('readTask')
  console.log('日志文件：' + logPath)
  await task.run(path) // 第一次任务同时写日志并通知终端。
  const cursor = session.read().at(-1).seq // 记住终端最后收到的序号。
  await app.remove('terminal') // 等价于一个展示端退出，撤销它的订阅。
  console.log('终端订阅已卸载，开始第二次任务；下面不应再出现[终端]事件。')
  app.services.get('settings').set({ prefix: '第二次读取' }) // 只影响下一次任务的快照。
  const result = await task.run(path) // 没有终端订阅者，业务与持久化仍正常进行。
  console.log('第二次任务完成，配置版本：' + result.config.revision)
  console.log('按游标补读：' + session.read(cursor).map(event => event.seq + ':' + event.type).join(' → '))
} finally {
  await app.close() // 先等任务结束，再撤销订阅与服务，最后关闭日志文件。
  console.log('应用已退出：插件=' + app.active.size + '，注册服务=' + app.services.entries.size)
}
