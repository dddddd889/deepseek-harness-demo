import type { SandboxMode } from './domain.ts';
export declare class SandboxUnavailableError extends Error {
    readonly code = "SANDBOX_UNAVAILABLE";
    constructor(message: string);
}
/** 同机进程沙箱 接口边界；完全访问模式直通，受限模式必须返回真正的内核执行器。 */
export declare class LocalSandbox {
    confine(argv: readonly string[], mode: SandboxMode, workspaceRoot: string): readonly string[];
}
