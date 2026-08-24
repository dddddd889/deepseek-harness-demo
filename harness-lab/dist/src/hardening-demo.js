import { HotBundle } from "./hot-bundle.js";
import { probeRuntime } from "./runtime-capabilities.js";
const hot = new HotBundle();
await hot.reload([{ name: 'v1', apply: async (ctx) => ctx.provide('version', 'v1') }]);
console.log(JSON.stringify({ generation: hot.generation, version: hot.use('version'), capabilities: probeRuntime() }));
await hot.dispose();
//# sourceMappingURL=hardening-demo.js.map