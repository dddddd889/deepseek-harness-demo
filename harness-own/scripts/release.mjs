import { readFileSync, mkdirSync, writeFileSync, copyFileSync, chmodSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

/** 每个目标只允许在对应系统构建，不能把交叉构建成功当原生资格。 */
export function releaseTarget(target, unsigned, environment = process.env, platform = process.platform) {
  const targets = { 'mac-arm64': ['darwin', '--mac', '--arm64'], 'mac-x64': ['darwin', '--mac', '--x64'], 'win-x64': ['win32', '--win', '--x64'], 'linux-x64': ['linux', '--linux', '--x64'], 'linux-arm64': ['linux', '--linux', '--arm64'] }
  const result = targets[target]
  if (!result || result[0] !== platform) throw Error('需要对应原生目标主机')
  if (!unsigned && result[0] === 'darwin' && ['CSC_LINK', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'].some(key => !environment[key])) throw Error('正式签名/公证凭据未配置')
  if (!unsigned && result[0] === 'win32' && !environment.CSC_LINK) throw Error('Windows正式签名凭据未配置')
  return result.slice(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const target = process.argv[2], unsigned = process.argv.includes('--unsigned'), flags = releaseTarget(target, unsigned)
  const config = JSON.parse(readFileSync('electron-builder.json', 'utf8'))
  if (unsigned) { config.mac.identity = null; config.mac.notarize = false }
  mkdirSync('.release-config', { recursive: true }); const file = '.release-config/' + target + '.json'; writeFileSync(file, JSON.stringify(config))
  // 本机 Bun 与目标架构必须一致；只复制当前验证过的二进制，跨架构载荷另行验收。
  if (!process.versions.bun || !target.endsWith(process.arch)) throw Error('需要对应目标架构的 Bun')
  mkdirSync('.runtime', { recursive: true }); copyFileSync(process.execPath, '.runtime/bun'); chmodSync('.runtime/bun', 0o755)
  if (process.platform === 'win32') config.extraResources[0].to = 'bun.exe'
  writeFileSync(file, JSON.stringify(config))
  const result = spawnSync(process.execPath, ['node_modules/electron-builder/cli.js', '--config', file, ...flags, '--publish', 'never'], { stdio: 'inherit', env: { ...process.env, ...(unsigned ? { CSC_IDENTITY_AUTO_DISCOVERY: 'false' } : {}) } })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
}
