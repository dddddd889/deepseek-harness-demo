import { HarnessContext, type Plugin } from './context.ts'

const context = new HarnessContext()

const clockPlugin: Plugin = {
  name: 'clock',
  async apply(pluginContext) {
    await pluginContext.provide('clock', { now: () => new Date().toISOString() })
  },
}

const reporterPlugin: Plugin = {
  name: 'reporter',
  async apply(pluginContext) {
    const clock = pluginContext.get<{ now(): string }>('clock')
    await pluginContext.on('demo/message', message => {
      console.log(`[${clock.now()}] ${String(message)}`)
    })
  },
}

const unmountClock = await context.mount(clockPlugin)
const unmountReporter = await context.mount(reporterPlugin)

console.log('挂载后：', context.inspect())
context.emit('demo/message', '最小插件内核正在工作')

await unmountReporter()
await unmountClock()
console.log('卸载后：', context.inspect())

