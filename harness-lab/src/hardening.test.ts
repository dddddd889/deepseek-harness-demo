import assert from 'node:assert/strict'
import { test } from 'bun:test'
import { FaultInjector } from './fault-injector.ts'
import { HotBundle } from './hot-bundle.ts'
import type { Plugin } from './context.ts'
import { probeRuntime, requireCapability } from './runtime-capabilities.ts'

const valuePlugin = (value: string): Plugin => ({ name: `value-${value}`, apply: async (ctx) => ctx.provide('value', value) })

test('热重载候选失败时旧插件包不闪断', async () => {
  const hot = new HotBundle()
  await hot.reload([valuePlugin('v1')])
  const broken: Plugin = { name: 'broken', apply: () => { throw new Error('配置坏了') } }
  await assert.rejects(hot.reload([broken]))
  assert.equal(hot.use('value'), 'v1')
  assert.equal(hot.generation, 1)
  await hot.reload([valuePlugin('v2')])
  assert.equal(hot.use('value'), 'v2')
  await hot.dispose()
})

test('能力探测明确区分强沙箱与仅进程隔离降级', () => {
  const linux = probeRuntime({ platform: 'linux', bunVersion: '1.3.14', ptyAvailable: false, commandExists: () => false })
  assert.equal(linux.sandbox, 'process-only')
  assert.throws(() => requireCapability(linux, 'pty'), /CAPABILITY_UNAVAILABLE:pty:linux/)
  const mac = probeRuntime({ platform: 'darwin', commandExists: () => true })
  assert.equal(mac.sandbox, 'seatbelt')
})

test('故障注入只在指定次数触发', async () => {
  const faults = new FaultInjector()
  faults.configure('provider.stream', 2, { kind: 'throw', message: 'network reset' })
  await faults.hit('provider.stream')
  await assert.rejects(faults.hit('provider.stream'), /network reset/)
  await faults.hit('provider.stream')
})
