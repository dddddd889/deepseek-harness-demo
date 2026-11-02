import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PluginManager, marketIndex } from '../src/market.mjs'

test('真实动态import插件、服务撤销和失败状态不提交', async () => {
  const root = mkdtempSync(join(tmpdir(), 'own-market-')), manager = new PluginManager(join(root, 'plugins.json'))
  try {
    const file = join(root, 'plugin.mjs')
    writeFileSync(file, 'export function setup({scope,services}){services.provide(scope,"proof",42)}')
    await manager.enable('proof', file)
    assert.equal(manager.runtime.services.get('proof'), 42)
    await manager.disable('proof'); assert.throws(() => manager.runtime.services.get('proof'), /缺少/)
    writeFileSync(join(root, 'bad.mjs'), 'export function setup(){throw Error("broken")}')
    await assert.rejects(manager.enable('bad', join(root, 'bad.mjs')), /broken/)
    assert.equal(manager.store.read().bad, undefined)
    assert.equal(marketIndex([{ name: 'p', version: '1', harness: { entry: './plugin.mjs' } }]).length, 1)
  } finally { await manager.close(); rmSync(root, { recursive: true, force: true }) }
})
