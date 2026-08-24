import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { ApprovalPolicy, SandboxMode } from './domain.ts'
import { assertJsonValue, snapshotJson } from './json.ts'

export interface HarnessProfile {
  readonly name: string
  readonly provider: 'deepseek' | 'scripted'
  readonly model: string
  readonly persistenceRoot: string
  readonly cwd: string
  readonly apiKeyEnv: string
  readonly baseURL?: string
  readonly system?: string
  readonly maxSteps: number
  readonly sandboxMode: SandboxMode
  readonly approvalPolicy: ApprovalPolicy
  readonly scriptedResponse?: string
}

export interface ProfileOverrides {
  readonly provider?: HarnessProfile['provider']
  readonly model?: string
  readonly persistenceRoot?: string
  readonly cwd?: string
  readonly baseURL?: string
  readonly system?: string
  readonly maxSteps?: number
  readonly sandboxMode?: SandboxMode
  readonly approvalPolicy?: ApprovalPolicy
}

const allowed = new Set([
  'name', 'provider', 'model', 'persistenceRoot', 'cwd', 'apiKeyEnv', 'baseURL', 'system',
  'maxSteps', 'sandboxMode', 'approvalPolicy', 'scriptedResponse',
])

/** 文件 < 环境变量 < 命令行；所有层最终走同一严格校验函数。 */
export async function loadProfile(
  path: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
  cli: ProfileOverrides = {},
): Promise<HarnessProfile> {
  let file: Record<string, unknown> = {}
  if (path !== undefined) {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
    assertJsonValue(parsed)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new TypeError('配置文件根节点必须是对象')
    file = parsed
  }
  for (const key of Object.keys(file)) if (!allowed.has(key)) throw new TypeError(`Profile 未知字段：${key}`)
  const merged: Record<string, unknown> = {
    name: 'headless', provider: 'deepseek', model: 'deepseek-chat',
    persistenceRoot: resolve('.harness-lab/sessions'), cwd: process.cwd(), apiKeyEnv: 'DEEPSEEK_API_KEY',
    maxSteps: 100, sandboxMode: 'read-only', approvalPolicy: 'ask',
    ...file,
    ...env.DSH_LAB_PROVIDER === undefined ? {} : { provider: env.DSH_LAB_PROVIDER },
    ...env.DSH_LAB_MODEL === undefined ? {} : { model: env.DSH_LAB_MODEL },
    ...env.DSH_LAB_SESSION_ROOT === undefined ? {} : { persistenceRoot: env.DSH_LAB_SESSION_ROOT },
    ...env.DSH_LAB_SANDBOX === undefined ? {} : { sandboxMode: env.DSH_LAB_SANDBOX },
    ...cli,
  }
  return validateProfile(merged)
}

export function validateProfile(value: Record<string, unknown>): HarnessProfile {
  const text = (key: string): string => {
    const candidate = value[key]
    if (typeof candidate !== 'string' || candidate.trim() === '') throw new TypeError(`Profile ${key} 必须为非空字符串`)
    return candidate
  }
  const provider = text('provider')
  if (provider !== 'deepseek' && provider !== 'scripted') throw new TypeError(`配置中的模型提供方无效：${provider}`)
  const sandboxMode = text('sandboxMode')
  if (!['read-only', 'workspace-write', 'danger-full-access'].includes(sandboxMode)) throw new TypeError(`配置中的沙箱模式无效：${sandboxMode}`)
  const approvalPolicy = text('approvalPolicy')
  if (approvalPolicy !== 'ask' && approvalPolicy !== 'never') throw new TypeError(`Profile approvalPolicy 无效：${approvalPolicy}`)
  const maxSteps = value.maxSteps
  if (!Number.isSafeInteger(maxSteps) || (maxSteps as number) <= 0) throw new TypeError('配置中的最大步骤数必须为正整数')
  const apiKeyEnv = text('apiKeyEnv')
  if (!/^[A-Z_][A-Z0-9_]*$/.test(apiKeyEnv)) throw new TypeError('配置中的密钥环境变量名称不合法')
  const optional = (key: string): string | undefined => value[key] === undefined ? undefined : text(key)
  const profile: HarnessProfile = {
    name: text('name'), provider, model: text('model'),
    persistenceRoot: resolve(text('persistenceRoot')), cwd: resolve(text('cwd')), apiKeyEnv,
    maxSteps: maxSteps as number,
    sandboxMode: sandboxMode as SandboxMode,
    approvalPolicy: approvalPolicy as ApprovalPolicy,
    ...optional('baseURL') === undefined ? {} : { baseURL: optional('baseURL') as string },
    ...optional('system') === undefined ? {} : { system: optional('system') as string },
    ...optional('scriptedResponse') === undefined ? {} : { scriptedResponse: optional('scriptedResponse') as string },
  }
  if (profile.provider === 'scripted' && profile.scriptedResponse === undefined) throw new TypeError('脚本模型提供方需要配置脚本响应')
  return snapshotJson(profile)
}
