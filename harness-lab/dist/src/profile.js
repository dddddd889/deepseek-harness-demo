import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assertJsonValue, snapshotJson } from "./json.js";
const allowed = new Set([
    'name', 'provider', 'model', 'persistenceRoot', 'cwd', 'apiKeyEnv', 'baseURL', 'system',
    'maxSteps', 'sandboxMode', 'approvalPolicy', 'scriptedResponse',
]);
/** 文件 < 环境变量 < 命令行；所有层最终走同一严格校验函数。 */
export async function loadProfile(path, env = process.env, cli = {}) {
    let file = {};
    if (path !== undefined) {
        const parsed = JSON.parse(await readFile(path, 'utf8'));
        assertJsonValue(parsed);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
            throw new TypeError('配置文件根节点必须是对象');
        file = parsed;
    }
    for (const key of Object.keys(file))
        if (!allowed.has(key))
            throw new TypeError(`Profile 未知字段：${key}`);
    const merged = {
        name: 'headless', provider: 'deepseek', model: 'deepseek-chat',
        persistenceRoot: resolve('.harness-lab/sessions'), cwd: process.cwd(), apiKeyEnv: 'DEEPSEEK_API_KEY',
        maxSteps: 100, sandboxMode: 'read-only', approvalPolicy: 'ask',
        ...file,
        ...env.DSH_LAB_PROVIDER === undefined ? {} : { provider: env.DSH_LAB_PROVIDER },
        ...env.DSH_LAB_MODEL === undefined ? {} : { model: env.DSH_LAB_MODEL },
        ...env.DSH_LAB_SESSION_ROOT === undefined ? {} : { persistenceRoot: env.DSH_LAB_SESSION_ROOT },
        ...env.DSH_LAB_SANDBOX === undefined ? {} : { sandboxMode: env.DSH_LAB_SANDBOX },
        ...cli,
    };
    return validateProfile(merged);
}
export function validateProfile(value) {
    const text = (key) => {
        const candidate = value[key];
        if (typeof candidate !== 'string' || candidate.trim() === '')
            throw new TypeError(`Profile ${key} 必须为非空字符串`);
        return candidate;
    };
    const provider = text('provider');
    if (provider !== 'deepseek' && provider !== 'scripted')
        throw new TypeError(`配置中的模型提供方无效：${provider}`);
    const sandboxMode = text('sandboxMode');
    if (!['read-only', 'workspace-write', 'danger-full-access'].includes(sandboxMode))
        throw new TypeError(`配置中的沙箱模式无效：${sandboxMode}`);
    const approvalPolicy = text('approvalPolicy');
    if (approvalPolicy !== 'ask' && approvalPolicy !== 'never')
        throw new TypeError(`Profile approvalPolicy 无效：${approvalPolicy}`);
    const maxSteps = value.maxSteps;
    if (!Number.isSafeInteger(maxSteps) || maxSteps <= 0)
        throw new TypeError('配置中的最大步骤数必须为正整数');
    const apiKeyEnv = text('apiKeyEnv');
    if (!/^[A-Z_][A-Z0-9_]*$/.test(apiKeyEnv))
        throw new TypeError('配置中的密钥环境变量名称不合法');
    const optional = (key) => value[key] === undefined ? undefined : text(key);
    const profile = {
        name: text('name'), provider, model: text('model'),
        persistenceRoot: resolve(text('persistenceRoot')), cwd: resolve(text('cwd')), apiKeyEnv,
        maxSteps: maxSteps,
        sandboxMode: sandboxMode,
        approvalPolicy: approvalPolicy,
        ...optional('baseURL') === undefined ? {} : { baseURL: optional('baseURL') },
        ...optional('system') === undefined ? {} : { system: optional('system') },
        ...optional('scriptedResponse') === undefined ? {} : { scriptedResponse: optional('scriptedResponse') },
    };
    if (profile.provider === 'scripted' && profile.scriptedResponse === undefined)
        throw new TypeError('脚本模型提供方需要配置脚本响应');
    return snapshotJson(profile);
}
//# sourceMappingURL=profile.js.map