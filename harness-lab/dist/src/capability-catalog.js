/** 统一目录只负责发现和所有权；执行仍由各自的深接口负责。 */
export class CapabilityCatalog {
    #entries = new Map();
    register(summary) {
        const key = `${summary.kind}:${summary.id}`;
        if (this.#entries.has(key))
            throw new Error(`能力已存在：${key}`);
        this.#entries.set(key, Object.freeze({ ...summary }));
        return () => this.#entries.delete(key);
    }
    list(kind) {
        return [...this.#entries.values()]
            .filter(entry => kind === undefined || entry.kind === kind)
            .sort((left, right) => `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`));
    }
}
//# sourceMappingURL=capability-catalog.js.map