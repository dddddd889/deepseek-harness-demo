export type CapabilityKind = 'skill' | 'tool' | 'web-search' | 'web-fetch' | 'lsp' | 'attachment';
export interface CapabilitySummary {
    readonly kind: CapabilityKind;
    readonly id: string;
    readonly provider: string;
    readonly description: string;
}
/** 统一目录只负责发现和所有权；执行仍由各自的深接口负责。 */
export declare class CapabilityCatalog {
    #private;
    register(summary: CapabilitySummary): () => void;
    list(kind?: CapabilityKind): readonly CapabilitySummary[];
}
