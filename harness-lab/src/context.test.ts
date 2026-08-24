import assert from 'node:assert/strict'
import { test } from 'bun:test'
import { HarnessContext, type Plugin } from './context.ts'

test('插件可以发布服务，卸载后服务消失', async () => {
  const context = new HarnessContext()
  const clockPlugin: Plugin = {
    name: 'clock',
    async apply(pluginContext) {
      await pluginContext.provide('clock', { now: () => 42 })
    },
  }

  const unmount = await context.mount(clockPlugin)
  assert.equal(context.get<{ now(): number }>('clock').now(), 42)
  assert.deepEqual(context.inspect().services, ['clock'])

  await unmount()
  assert.throws(() => context.get('clock'), /不可用/)
})

test('事件监听器跟随插件生命周期自动撤销', async () => {
  const context = new HarnessContext()
  const received: string[] = []
  const observerPlugin: Plugin = {
    name: 'observer',
    async apply(pluginContext) {
      await pluginContext.on('agent/status', (status) => received.push(String(status)))
    },
  }

  const unmount = await context.mount(observerPlugin)
  context.emit('agent/status', 'running')
  await unmount()
  context.emit('agent/status', 'stopped')

  assert.deepEqual(received, ['running'])
  assert.deepEqual(context.inspect().listeners, {})
})

test('清理操作按照后进先出顺序执行', async () => {
  const context = new HarnessContext()
  const order: string[] = []
  const plugin: Plugin = {
    name: 'ordered-cleanup',
    async apply(pluginContext) {
      await pluginContext.effect(() => () => { order.push('first') })
      await pluginContext.effect(() => () => { order.push('second') })
    },
  }

  const unmount = await context.mount(plugin)
  await unmount()
  assert.deepEqual(order, ['second', 'first'])
})

test('插件启动失败会回滚部分注册，容器保持干净', async () => {
  const context = new HarnessContext()
  const brokenPlugin: Plugin = {
    name: 'broken',
    async apply(pluginContext) {
      await pluginContext.provide('temporary', { alive: true })
      await pluginContext.on('temporary/event', () => {})
      throw new Error('模拟启动失败')
    },
  }

  await assert.rejects(() => context.mount(brokenPlugin), /模拟启动失败/)
  assert.deepEqual(context.inspect(), { services: [], plugins: [], listeners: {} })
})

test('服务键冲突时失败并保留原服务', async () => {
  const context = new HarnessContext()
  const first = await context.mount({
    name: 'first',
    apply: async pluginContext => pluginContext.provide('shared', { source: 'first' }),
  })

  await assert.rejects(
    () => context.mount({
      name: 'second',
      apply: async pluginContext => pluginContext.provide('shared', { source: 'second' }),
    }),
    /已由插件 first 发布/,
  )
  assert.equal(context.get<{ source: string }>('shared').source, 'first')
  assert.deepEqual(context.inspect().plugins, ['first'])
  await first()
})
