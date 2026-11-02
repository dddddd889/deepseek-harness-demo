import { mkdir, writeFile, readFile, rename, rm } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { execute } from './process.mjs'

/** 下载缓存按可信锁hash接纳；坏文件永远不能成为已安装运行时。 */
export async function asset(spec, directory, fetcher = fetch) {
  if (!/^[a-f0-9]{64}$/.test(spec.sha256)) throw Error('运行时锁缺少SHA256')
  await mkdir(directory, { recursive: true })
  const response = await fetcher(spec.url)
  if (!response.ok) throw Error('运行时下载HTTP ' + response.status)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (createHash('sha256').update(bytes).digest('hex') !== spec.sha256) throw Error('运行时校验失败')
  const path = join(directory, spec.sha256)
  await writeFile(path, bytes, { mode: 0o600 }); return path
}

/** 每个target单独暂存，完整验证后原子发布；已安装目录不静默覆盖。 */
export async function installRuntime(specs, destination, signal) {
  const target = resolve(destination), staging = target + '.staging-' + randomUUID()
  await mkdir(staging, { recursive: true })
  try {
    const manifest = []
    for (const spec of specs) {
      if (!/^[a-z][a-z0-9-]*$/.test(spec.name)) throw Error('运行时组件名不合法')
      const archive = await asset(spec, join(staging, '.cache'))
      const directory = join(staging, spec.name); await mkdir(directory)
      const listing = await execute({ command: 'tar', args: ['-tf', archive] }, signal)
      if (listing.code || listing.output.split('\n').some(name => name.startsWith('/') || name.split('/').includes('..'))) throw Error('运行时归档越界')
      const extraction = await execute({ command: 'tar', args: ['-xf', archive, '-C', directory], timeout: 60_000 }, signal)
      if (extraction.code) throw Error('运行时解包失败')
      manifest.push({ name: spec.name, sha256: spec.sha256, executable: spec.executable })
    }
    await writeFile(join(staging, 'manifest.json'), JSON.stringify(manifest))
    await rename(staging, target)
    return manifest
  } catch (error) { await rm(staging, { recursive: true, force: true }); throw error }
}

/** 只返回载荷里的显式路径，缺少时不退回系统PATH。 */
export async function workspaceDependencies(root) {
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')), result = {}
  for (const item of manifest) {
    const path = resolve(root, item.name, item.executable)
    if (!path.startsWith(resolve(root) + '/')) throw Error('运行时路径越界')
    await readFile(path); result[item.name] = path
  }
  return result
}
