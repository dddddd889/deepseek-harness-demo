import type { JsonValue } from './json.ts'
import type { ToolDefinition } from './domain.ts'
import type { SandboxMode } from './domain.ts'
import { LocalProcessRuntime } from './local-process.ts'
import type { ManagedProcess, ProcessOutcome, TerminalHandle } from './local-process.ts'
import { LocalSandbox } from './local-sandbox.ts'

export interface ShellRequest {
  readonly command: string
  readonly timeoutMs?: number
  readonly maxOutputBytes?: number
  readonly signal?: AbortSignal
  readonly sandboxMode?: SandboxMode
}

/** 终端解释器只决定解释器与默认值；进程树、输出和终止仍由 本地进程运行时 拥有。 */
export class LocalShell {
  readonly #runtime: LocalProcessRuntime
  readonly #cwd: string
  readonly #sandbox: LocalSandbox

  constructor(runtime: LocalProcessRuntime, cwd: string, sandbox = new LocalSandbox()) {
    this.#runtime = runtime
    this.#cwd = cwd
    this.#sandbox = sandbox
  }

  run(request: ShellRequest): Promise<ProcessOutcome> {
    return this.#runtime.run(this.spec(request))
  }

  start(request: Omit<ShellRequest, 'timeoutMs'>): ManagedProcess {
    return this.#runtime.spawn(this.spec(request))
  }

  spawnTerminal(signal?: AbortSignal, sandboxMode: SandboxMode = 'danger-full-access'): Promise<TerminalHandle> {
    return this.#runtime.spawnTerminal({
      argv: this.#sandbox.confine(interactiveShellArgv(), sandboxMode, this.#cwd),
      cwd: this.#cwd, ...(signal === undefined ? {} : { signal }),
    })
  }

  private spec(request: ShellRequest) {
    return {
      argv: this.#sandbox.confine(shellArgv(request.command), request.sandboxMode ?? 'danger-full-access', this.#cwd),
      cwd: this.#cwd,
      timeoutMs: request.timeoutMs ?? 120_000,
      maxOutputBytes: request.maxOutputBytes ?? 64_000,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    }
  }
}

/** 将前台终端解释器 暴露为工具；后台任务由后台任务阶段统一分配标识 和轮询语义。 */
export function createShellTool(shell: LocalShell): ToolDefinition {
  return {
    name: 'shell_exec', description: '在工作区中运行一条终端命令',
    parameters: {
      type: 'object', required: ['command'], additionalProperties: false,
      properties: {
        command: { type: 'string', minLength: 1 },
        timeout_ms: { type: 'integer', minimum: 1, maximum: 600_000 },
        max_output_bytes: { type: 'integer', minimum: 0, maximum: 1_000_000 },
        sandbox_permissions: { enum: ['workspace-write', 'danger-full-access'] },
        justification: { type: 'string', minLength: 1 },
      },
    },
    effect: () => ({ minimumMode: 'read-only', reason: 'Shell 命令至少需要只读进程沙箱' }),
    async execute(args, signal, context): Promise<JsonValue> {
      if (typeof args !== 'object' || args === null || Array.isArray(args)) throw new Error('参数类型错误')
      const result = await shell.run({
        command: String(args.command), signal,
        ...(typeof args.timeout_ms === 'number' ? { timeoutMs: args.timeout_ms } : {}),
        ...(typeof args.max_output_bytes === 'number' ? { maxOutputBytes: args.max_output_bytes } : {}),
        sandboxMode: context?.sandboxMode ?? 'danger-full-access',
      })
      return {
        exitCode: result.exitCode,
        signal: result.signal,
        timedOut: result.timedOut,
        aborted: result.aborted,
        durationMs: result.durationMs,
        stdout: outputJson(result.stdout),
        stderr: outputJson(result.stderr),
      }
    },
  }
}

/** 选择平台终端解释器；命令参数不在 运行时层做二次拼接。 */
function shellArgv(command: string): string[] {
  if (process.platform === 'win32') return ['pwsh.exe', '-NoLogo', '-NoProfile', '-Command', command]
  return ['/bin/bash', '--noprofile', '--norc', '-c', command]
}

/** 交互终端不能携带 -c，否则终端解释器 会在空命令后立即退出。 */
function interactiveShellArgv(): string[] {
  if (process.platform === 'win32') return ['pwsh.exe', '-NoLogo', '-NoProfile']
  return ['/bin/bash', '--noprofile', '--norc']
}

/** 将输出对象收窄为无损 JSON。 */
function outputJson(output: ProcessOutcome['stdout']): JsonValue {
  return {
    text: output.text, bytes: output.bytes, truncated: output.truncated,
    ...(output.spillPath === undefined ? {} : { spillPath: output.spillPath }),
  }
}
