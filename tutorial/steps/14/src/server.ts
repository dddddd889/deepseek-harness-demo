import { createRuntime } from './runtime';
import { serve } from './http';
// 端口可以设成 0，由操作系统分配；Electron 会使用这一点避免冲突。
const runtime = await createRuntime();
let api: ReturnType<typeof serve>;
try { api = serve(runtime, Number(process.env.PORT ?? 4319)); }
catch (error) { await runtime.shutdown(); throw error; }
console.log(`打开：http://127.0.0.1:${api.server.port}/?token=${api.token}`);
let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true; api.close(); await runtime.shutdown();
};
process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });
