import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { releaseTarget } from '../scripts/release.mjs'
import { readFileSync } from 'node:fs'

test('正式资格缺凭据失败，打包清单不包含用户数据', () => {
  assert.throws(() => releaseTarget('mac-arm64', false, {}, 'darwin'), /凭据/)
  assert.throws(() => releaseTarget('win-x64', true, {}, 'darwin'), /主机/)
  assert.deepEqual(releaseTarget('mac-arm64', true, {}, 'darwin'), ['--mac', '--arm64'])
  const config = JSON.parse(readFileSync('electron-builder.json'))
  assert.ok(!config.files.some(value => value.includes('.data') || value.includes('.harness') || value.includes('credentials')))
})
