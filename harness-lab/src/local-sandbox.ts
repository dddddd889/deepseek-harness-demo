import { realpathSync } from 'node:fs'
import type { SandboxMode } from './domain.ts'

export class SandboxUnavailableError extends Error {
  readonly code = 'SANDBOX_UNAVAILABLE'
  constructor(message: string) {
    super(message)
    this.name = 'SandboxUnavailableError'
  }
}

/** 同机进程沙箱 接口边界；完全访问模式直通，受限模式必须返回真正的内核执行器。 */
export class LocalSandbox {
  confine(argv: readonly string[], mode: SandboxMode, workspaceRoot: string): readonly string[] {
    if (mode === 'danger-full-access') return argv
    if (process.platform !== 'darwin') {
      throw new SandboxUnavailableError(`当前教学实现尚未为 ${process.platform} 配置受限 runner，拒绝无沙箱执行`)
    }
    const root = realpathSync(workspaceRoot)
    const writeRules = mode === 'workspace-write'
      ? `(allow file-write* (subpath ${seatbeltString(root)}))`
      : ''
    const profile = [
      '(version 1)',
      '(allow default)',
      '(deny file-write*)',
      // 终端和常见输出 日志接收端 不是普通文件副作用。
      '(allow file-write* (literal "/dev/null"))',
      '(allow file-write* (regex #"^/dev/tty"))',
      writeRules,
    ].filter(Boolean).join(' ')
    return ['/usr/bin/sandbox-exec', '-p', profile, '--', ...argv]
  }
}

/** 生成 系统沙箱 字符串字面量。 */
function seatbeltString(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}
