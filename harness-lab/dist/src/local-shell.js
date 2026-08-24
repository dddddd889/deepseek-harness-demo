import { LocalProcessRuntime } from "./local-process.js";
import { LocalSandbox } from "./local-sandbox.js";
/** Shell 只决定解释器与默认值；进程树、输出和终止仍由 LocalProcessRuntime 拥有。 */
export class LocalShell {
    #runtime;
    #cwd;
    #sandbox;
    constructor(runtime, cwd, sandbox = new LocalSandbox()) {
        this.#runtime = runtime;
        this.#cwd = cwd;
        this.#sandbox = sandbox;
    }
    run(request) {
        return this.#runtime.run(this.spec(request));
    }
    start(request) {
        return this.#runtime.spawn(this.spec(request));
    }
    spawnTerminal(signal, sandboxMode = 'danger-full-access') {
        return this.#runtime.spawnTerminal({
            argv: this.#sandbox.confine(interactiveShellArgv(), sandboxMode, this.#cwd),
            cwd: this.#cwd, ...(signal === undefined ? {} : { signal }),
        });
    }
    spec(request) {
        return {
            argv: this.#sandbox.confine(shellArgv(request.command), request.sandboxMode ?? 'danger-full-access', this.#cwd),
            cwd: this.#cwd,
            timeoutMs: request.timeoutMs ?? 120_000,
            maxOutputBytes: request.maxOutputBytes ?? 64_000,
            ...(request.signal === undefined ? {} : { signal: request.signal }),
        };
    }
}
/** 将前台 Shell 暴露为工具；后台任务归 Jobs 阶段统一分配 id 和轮询语义。 */
export function createShellTool(shell) {
    return {
        name: 'shell_exec', description: '在 workspace 中运行一条 shell 命令',
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
        async execute(args, signal, context) {
            if (typeof args !== 'object' || args === null || Array.isArray(args))
                throw new Error('参数类型错误');
            const result = await shell.run({
                command: String(args.command), signal,
                ...(typeof args.timeout_ms === 'number' ? { timeoutMs: args.timeout_ms } : {}),
                ...(typeof args.max_output_bytes === 'number' ? { maxOutputBytes: args.max_output_bytes } : {}),
                sandboxMode: context?.sandboxMode ?? 'danger-full-access',
            });
            return {
                exitCode: result.exitCode,
                signal: result.signal,
                timedOut: result.timedOut,
                aborted: result.aborted,
                durationMs: result.durationMs,
                stdout: outputJson(result.stdout),
                stderr: outputJson(result.stderr),
            };
        },
    };
}
/** 选择平台 shell；命令参数不在 Node 层做二次拼接。 */
function shellArgv(command) {
    if (process.platform === 'win32')
        return ['pwsh.exe', '-NoLogo', '-NoProfile', '-Command', command];
    return ['/bin/bash', '--noprofile', '--norc', '-c', command];
}
/** 交互终端不能携带 -c，否则 shell 会在空命令后立即退出。 */
function interactiveShellArgv() {
    if (process.platform === 'win32')
        return ['pwsh.exe', '-NoLogo', '-NoProfile'];
    return ['/bin/bash', '--noprofile', '--norc'];
}
/** 将输出对象收窄为 lossless JSON。 */
function outputJson(output) {
    return {
        text: output.text, bytes: output.bytes, truncated: output.truncated,
        ...(output.spillPath === undefined ? {} : { spillPath: output.spillPath }),
    };
}
//# sourceMappingURL=local-shell.js.map