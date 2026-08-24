export interface RuntimeCapabilities {
    readonly platform: NodeJS.Platform;
    readonly bunVersion: string;
    readonly workerThreads: boolean;
    readonly pty: boolean;
    readonly sandbox: 'seatbelt' | 'process-only';
    readonly shell: string | undefined;
}
/** 启动时探测平台能力；上层据此降级或立即给出稳定错误。 */
export declare function probeRuntime(input?: {
    readonly platform?: NodeJS.Platform;
    readonly bunVersion?: string;
    readonly shell?: string;
    readonly commandExists?: (path: string) => boolean;
    readonly ptyAvailable?: boolean;
}): RuntimeCapabilities;
/** 对不可降级的能力 fail-fast，并包含可诊断的 capability key。 */
export declare function requireCapability(capabilities: RuntimeCapabilities, key: 'pty' | 'strong-sandbox'): void;
