import { spawnSync } from 'node:child_process'

/** OS confinement 的编译器；探测失败必须拒绝，绝不降级为裸执行。 */
export class Sandbox {
  constructor(platform = process.platform, probe = command => spawnSync(command, ['--help'], { stdio: 'ignore' }).error === undefined) { this.platform = platform; this.probe = probe }
  /** 显式构造可审计执行Spec，调用方最终仍交给subprocess提供方。 */
  wrap(spec, { workspace, mode = 'workspace-write' }) {
    if (!['read-only', 'workspace-write'].includes(mode)) throw Error('未知沙箱模式')
    if (this.platform === 'darwin') {
      if (!this.probe('/usr/bin/sandbox-exec')) throw Error('Seatbelt 不可用，拒绝执行')
      const path = JSON.stringify(workspace)
      const profile = `(version 1)(deny default)(allow process*)(allow sysctl-read)(allow mach-lookup)(allow file-read*)(allow file-write* (literal "/dev/null")${mode === 'workspace-write' ? ` (subpath ${path})` : ''})`
      return { ...spec, command: '/usr/bin/sandbox-exec', args: ['-p', profile, spec.command, ...(spec.args ?? [])] }
    }
    if (this.platform === 'linux') {
      if (!this.probe('bwrap')) throw Error('bwrap 不可用，拒绝执行')
      return { ...spec, command: 'bwrap', args: ['--die-with-parent', '--unshare-all', '--ro-bind', '/', '/', ...(mode === 'workspace-write' ? ['--bind', workspace, workspace] : []), '--dev', '/dev', '--proc', '/proc', '--chdir', workspace, '--', spec.command, ...(spec.args ?? [])] }
    }
    // Windows 必须新增真实 ACL/令牌提供方后才开放，不能拿路径校验充数。
    throw Error('当前平台沙箱尚未实现，拒绝执行')
  }
}