export interface ProcessSpec {
    readonly argv: readonly string[];
    readonly cwd: string;
    readonly env?: Readonly<Record<string, string>>;
    readonly signal?: AbortSignal;
    readonly timeoutMs?: number;
    readonly graceMs?: number;
    readonly maxOutputBytes?: number;
}
export interface CollectedOutput {
    readonly text: string;
    readonly bytes: number;
    readonly truncated: boolean;
    readonly spillPath?: string;
}
export interface ProcessOutcome {
    readonly exitCode: number | null;
    readonly signal: NodeJS.Signals | null;
    readonly timedOut: boolean;
    readonly aborted: boolean;
    readonly durationMs: number;
    readonly stdout: CollectedOutput;
    readonly stderr: CollectedOutput;
}
export interface ManagedProcess {
    readonly pid: number;
    readonly done: Promise<ProcessOutcome>;
    terminate(): void;
}
export interface TerminalHandle {
    readonly pid: number;
    readonly done: Promise<{
        exitCode: number;
        signal?: number;
    }>;
    write(data: string): void;
    resize(cols: number, rows: number): void;
    onData(listener: (data: string) => void): () => void;
    terminate(): Promise<void>;
}
/** 框架子进程同款敏感环境名启发式：默认绝不向孩子泄漏凭证或 DSH_*。 */
export declare const SENSITIVE_ENV_PATTERN: RegExp;
/** 本地受管进程运行时：拥有所有进程树与溢出文件的生命周期。 */
export declare class LocalProcessRuntime {
    #private;
    private constructor();
    static create(): Promise<LocalProcessRuntime>;
    spawn(spec: ProcessSpec): ManagedProcess;
    run(spec: ProcessSpec): Promise<ProcessOutcome>;
    /** 使用 Bun 原生终端分配真实伪终端，不再加载第三方伪终端扩展。 */
    spawnTerminal(spec: Omit<ProcessSpec, 'timeoutMs' | 'maxOutputBytes'> & {
        readonly cols?: number;
        readonly rows?: number;
    }): Promise<TerminalHandle>;
    /** 组合卸载时停止并等待全部孩子，之后删除运行时拥有的溢出文件。 */
    dispose(): Promise<void>;
}
/** 生成清洗后的子进程环境，显式环境变量 最后覆盖。 */
export declare function childEnvironment(explicit?: Readonly<Record<string, string>>): NodeJS.ProcessEnv;
/** 教学/测试辅助：读取发生截断时的完整 溢出。 */
export declare function readSpill(output: CollectedOutput): Promise<string | undefined>;
