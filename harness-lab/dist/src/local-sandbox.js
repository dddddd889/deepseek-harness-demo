import { realpathSync } from 'node:fs';
export class SandboxUnavailableError extends Error {
    code = 'SANDBOX_UNAVAILABLE';
    constructor(message) {
        super(message);
        this.name = 'SandboxUnavailableError';
    }
}
/** 同机进程沙箱 seam；danger 模式直通，受限模式必须返回真正的内核 runner。 */
export class LocalSandbox {
    confine(argv, mode, workspaceRoot) {
        if (mode === 'danger-full-access')
            return argv;
        if (process.platform !== 'darwin') {
            throw new SandboxUnavailableError(`当前教学实现尚未为 ${process.platform} 配置受限 runner，拒绝无沙箱执行`);
        }
        const root = realpathSync(workspaceRoot);
        const writeRules = mode === 'workspace-write'
            ? `(allow file-write* (subpath ${seatbeltString(root)}))`
            : '';
        const profile = [
            '(version 1)',
            '(allow default)',
            '(deny file-write*)',
            // 终端和常见输出 sink 不是普通文件副作用。
            '(allow file-write* (literal "/dev/null"))',
            '(allow file-write* (regex #"^/dev/tty"))',
            writeRules,
        ].filter(Boolean).join(' ');
        return ['/usr/bin/sandbox-exec', '-p', profile, '--', ...argv];
    }
}
/** 生成 Seatbelt 字符串字面量。 */
function seatbeltString(value) {
    return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}
//# sourceMappingURL=local-sandbox.js.map