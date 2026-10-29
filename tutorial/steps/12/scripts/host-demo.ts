import { createRuntime } from '../src/runtime';
// 读、工具循环、写审批与恢复历史，都从同一组装点进入。
const runtime = await createRuntime();
try {
  const session = runtime.host.create();
  session.subscribe(event => console.log(event.seq, event.type, event.data));
  await runtime.start(session.id, '/tool read {"path":"package.json"}').done;
  console.log('记住这个 sessionId：', session.id);
} finally { await runtime.shutdown(); }
