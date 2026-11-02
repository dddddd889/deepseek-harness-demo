import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

// Bun 直接执行安装器时不会像 npm run 那样注入 npmrc 字段，显式继承已有 Electron 镜像。
const environment = { ...process.env } // 显式环境变量优先于配置文件。
let mirror // 只读取下载镜像，不读取或输出 registry token。
for (const path of [join(homedir(), '.npmrc'), join(process.cwd(), '.npmrc')]) {
  try {
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const match = /^\s*electron[_-]mirror\s*=\s*(.*?)\s*$/.exec(line)
      if (match) mirror = match[1].replace(/^['"]|['"]$/g, '')
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error }
}
if (!environment.ELECTRON_MIRROR && !environment.npm_config_electron_mirror && mirror) environment.ELECTRON_MIRROR = mirror
const result = spawnSync(process.execPath, ['node_modules/electron/install.js'], { env: environment, stdio: 'inherit', timeout: 180_000 })
if (result.error) throw result.error
process.exitCode = result.status ?? 1
