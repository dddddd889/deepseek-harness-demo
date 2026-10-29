import { runAgent } from '../src/agent';
import { Session } from '../src/session';
import { Tools, registerRead } from '../src/tools';
import { fakeModel } from '../src/fake-model';
// 同一个 runAgent，后面会被三个协议入口共同调用。
const session = new Session();
const tools = new Tools();
registerRead(tools, process.cwd());
session.subscribe(event => console.log(event.seq, event.type, event.data));
await runAgent({ session, tools, model: fakeModel, prompt: '/tool read {"path":"package.json"}', signal: new AbortController().signal });
