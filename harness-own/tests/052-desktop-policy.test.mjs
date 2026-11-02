import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { desktopPaths, deepLink, hostRuntime } from '../desktop/policy.mjs'

test('桌面路径来自产物根，深链接不承载任意命令', () => {
  const paths = desktopPaths('/app/resources/app', '/user/application')
  assert.equal(paths.host, '/app/resources/app/src/web-server.mjs')
  assert.ok(paths.home.startsWith('/user/application/'))
  assert.throws(() => deepLink('https://evil/'), /不合法/)
  assert.equal(deepLink('harness-own://session/session_abc-123'), 'session_abc-123')
})

test('桌面 Host 始终使用明确的 Bun 路径，缺少时直接失败', () => {
  assert.equal(hostRuntime({ packaged: false, developmentPath: '/tools/bun' }), '/tools/bun')
  assert.throws(() => hostRuntime({ packaged: false }), /Bun绝对路径|Bun 绝对路径/)
  assert.equal(hostRuntime({ packaged: true, resourcesPath: '/app/resources', platform: 'darwin' }), '/app/resources/bun')
  assert.equal(hostRuntime({ packaged: true, resourcesPath: '/app/resources', platform: 'win32' }), '/app/resources/bun.exe')
})
