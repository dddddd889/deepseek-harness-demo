import { accessSync, constants } from 'node:fs'

export interface RuntimeCapabilities {
  readonly platform: NodeJS.Platform
  readonly bunVersion: string
  readonly workerThreads: boolean
  readonly pty: boolean
  readonly sandbox: 'seatbelt' | 'process-only'
  readonly shell: string | undefined
}

/** 启动时探测平台能力；上层据此降级或立即给出稳定错误。 */
export function probeRuntime(input: {
  readonly platform?: NodeJS.Platform
  readonly bunVersion?: string
  readonly shell?: string
  readonly commandExists?: (path: string) => boolean
  readonly ptyAvailable?: boolean
} = {}): RuntimeCapabilities {
  const platform = input.platform ?? process.platform
  const commandExists = input.commandExists ?? isExecutable
  const shell = input.shell ?? process.env.SHELL
  const seatbelt = platform === 'darwin' && commandExists('/usr/bin/sandbox-exec')
  return {
    platform,
    bunVersion: input.bunVersion ?? Bun.version,
    workerThreads: true,
    pty: input.ptyAvailable ?? true,
    sandbox: seatbelt ? 'seatbelt' : 'process-only',
    shell,
  }
}

/** 对不可降级的能力 fail-fast，并包含可诊断的 capability key。 */
export function requireCapability(capabilities: RuntimeCapabilities, key: 'pty' | 'strong-sandbox'): void {
  const available = key === 'pty' ? capabilities.pty : capabilities.sandbox === 'seatbelt'
  if (!available) throw new Error(`CAPABILITY_UNAVAILABLE:${key}:${capabilities.platform}`)
}

function isExecutable(path: string): boolean {
  try { accessSync(path, constants.X_OK); return true } catch { return false }
}
