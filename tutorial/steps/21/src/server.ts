import { createRuntime } from './runtime';
import { serve } from './http';
// JSON 就绪行供 Electron 主进程读取；浏览器用户也可直接复制其中的 URL。
const runtime = await createRuntime();
let api: ReturnType<typeof serve>;
try { api = serve(runtime, Number(process.env.PORT ?? 4319)); }
catch (error) { await runtime.shutdown(); throw error; }
console.log(JSON.stringify({ type: 'ready', url: `http://127.0.0.1:${api.server.port}/?token=${api.token}` }));
let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true; api.close(); await runtime.shutdown();
};
process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });
