import type { ApprovalPolicy, SandboxMode } from './domain.ts';
export interface HarnessProfile {
    readonly name: string;
    readonly provider: 'deepseek' | 'scripted';
    readonly model: string;
    readonly persistenceRoot: string;
    readonly cwd: string;
    readonly apiKeyEnv: string;
    readonly baseURL?: string;
    readonly system?: string;
    readonly maxSteps: number;
    readonly sandboxMode: SandboxMode;
    readonly approvalPolicy: ApprovalPolicy;
    readonly scriptedResponse?: string;
}
export interface ProfileOverrides {
    readonly provider?: HarnessProfile['provider'];
    readonly model?: string;
    readonly persistenceRoot?: string;
    readonly cwd?: string;
    readonly baseURL?: string;
    readonly system?: string;
    readonly maxSteps?: number;
    readonly sandboxMode?: SandboxMode;
    readonly approvalPolicy?: ApprovalPolicy;
}
/** file < environment < CLI；所有层最终走同一严格校验函数。 */
export declare function loadProfile(path: string | undefined, env?: NodeJS.ProcessEnv, cli?: ProfileOverrides): Promise<HarnessProfile>;
export declare function validateProfile(value: Record<string, unknown>): HarnessProfile;
