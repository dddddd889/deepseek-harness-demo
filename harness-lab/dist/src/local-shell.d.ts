import type { ToolDefinition } from './domain.ts';
import type { SandboxMode } from './domain.ts';
import { LocalProcessRuntime } from './local-process.ts';
import type { ManagedProcess, ProcessOutcome, TerminalHandle } from './local-process.ts';
import { LocalSandbox } from './local-sandbox.ts';
export interface ShellRequest {
    readonly command: string;
    readonly timeoutMs?: number;
    readonly maxOutputBytes?: number;
    readonly signal?: AbortSignal;
    readonly sandboxMode?: SandboxMode;
}
/** 终端解释器只决定解释器与默认值；进程树、输出和终止仍由 本地进程运行时 拥有。 */
export declare class LocalShell {
    #private;
    constructor(runtime: LocalProcessRuntime, cwd: string, sandbox?: LocalSandbox);
    run(request: ShellRequest): Promise<ProcessOutcome>;
    start(request: Omit<ShellRequest, 'timeoutMs'>): ManagedProcess;
    spawnTerminal(signal?: AbortSignal, sandboxMode?: SandboxMode): Promise<TerminalHandle>;
    private spec;
}
/** 将前台终端解释器 暴露为工具；后台任务由后台任务阶段统一分配标识 和轮询语义。 */
export declare function createShellTool(shell: LocalShell): ToolDefinition;
