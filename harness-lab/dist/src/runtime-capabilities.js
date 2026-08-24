import { accessSync, constants } from 'node:fs';
/** 启动时探测平台能力；上层据此降级或立即给出稳定错误。 */
export function probeRuntime(input = {}) {
    const platform = input.platform ?? process.platform;
    const commandExists = input.commandExists ?? isExecutable;
    const shell = input.shell ?? process.env.SHELL;
    const seatbelt = platform === 'darwin' && commandExists('/usr/bin/sandbox-exec');
    return {
        platform,
        bunVersion: input.bunVersion ?? Bun.version,
        workerThreads: true,
        pty: input.ptyAvailable ?? true,
        sandbox: seatbelt ? 'seatbelt' : 'process-only',
        shell,
    };
}
/** 对不可降级的能力 快速失败，并包含可诊断的 能力键。 */
export function requireCapability(capabilities, key) {
    const available = key === 'pty' ? capabilities.pty : capabilities.sandbox === 'seatbelt';
    if (!available)
        throw new Error(`CAPABILITY_UNAVAILABLE:${key}:${capabilities.platform}`);
}
function isExecutable(path) {
    try {
        accessSync(path, constants.X_OK);
        return true;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=runtime-capabilities.js.map