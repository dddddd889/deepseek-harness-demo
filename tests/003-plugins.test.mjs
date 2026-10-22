import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { Plugins } from '../src/plugins.mjs'

test('Profile 中途失败，已经装上的服务也回滚', async () => {
  const plugins = new Plugins()
  await assert.rejects(plugins.profile([{ name: 'a' }, { name: 'broken' }], {
    a: ({ scope, services }) => services.provide(scope, 'x', 1),
    broken: () => { throw Error('安装失败') },
  }), /安装失败/)
  assert.throws(() => plugins.services.get('x'), /缺少/)
  await plugins.close()
})