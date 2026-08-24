import type { SandboxMode } from './domain.ts';
export declare class SandboxUnavailableError extends Error {
    readonly code = "SANDBOX_UNAVAILABLE";
    constructor(message: string);
}
/** 同机进程沙箱 seam；danger 模式直通，受限模式必须返回真正的内核 runner。 */
export declare class LocalSandbox {
    confine(argv: readonly string[], mode: SandboxMode, workspaceRoot: string): readonly string[];
}
