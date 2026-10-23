import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { Sandbox } from '../src/sandbox.mjs'

test('沙箱缺失拒绝，命令与参数仍分离，未知平台不裸跑', () => {
  const spec = { command: '/bin/echo', args: ['hello world'] }
  assert.throws(() => new Sandbox('linux', () => false).wrap(spec, { workspace: '/tmp/a' }), /拒绝/)
  const result = new Sandbox('linux', () => true).wrap(spec, { workspace: '/tmp/a' })
  assert.equal(result.command, 'bwrap'); assert.equal(result.args.at(-1), 'hello world')
  assert.throws(() => new Sandbox('win32').wrap(spec, { workspace: 'C:\\a' }), /尚未实现/)
})
