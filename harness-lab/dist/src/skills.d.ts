export interface SkillSummary {
    readonly name: string;
    readonly description: string;
    readonly provider: string;
    readonly rank: number;
    readonly modelInvocable: boolean;
    readonly userInvocable: boolean;
    readonly resourceBase: string;
}
export interface SkillDefinition extends SkillSummary {
    readonly content: string;
    readonly path: string;
}
/** 文件系统技能：低优先级者胜出，列表操作不加载正文，读取操作才读取最新内容。 */
export declare class SkillRegistry {
    #private;
    constructor(roots: readonly {
        readonly path: string;
        readonly rank: number;
        readonly provider: string;
    }[]);
    refresh(): Promise<void>;
    list(view?: 'model' | 'user'): readonly SkillSummary[];
    get(name: string, view?: 'model' | 'user'): Promise<SkillDefinition | undefined>;
    /** 渲染时明确资源基址，模型才能安全解析相对引用。 */
    render(skill: SkillDefinition): string;
}
