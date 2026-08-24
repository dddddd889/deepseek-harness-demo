import { HotBundle } from "./hot-bundle.js";
import { probeRuntime } from "./runtime-capabilities.js";
const hot = new HotBundle();
await hot.reload([{ name: 'v1', apply: async (ctx) => ctx.provide('version', 'v1') }]);
console.log(JSON.stringify({ 代次: hot.generation, 版本: hot.use('version'), 运行时能力: probeRuntime() }));
await hot.dispose();
//# sourceMappingURL=hardening-demo.js.map