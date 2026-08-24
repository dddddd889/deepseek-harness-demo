import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentServer } from "./agent-server.js";
import { HeadlessHost } from "./headless-host.js";
import { validateProfile } from "./profile.js";
const root = await mkdtemp(join(tmpdir(), 'harness-agent-server-demo-'));
const token = 'demo-token-0123456789abcdef';
try {
    const profile = validateProfile({
        name: 'server-demo', provider: 'scripted', model: 'fixture', scriptedResponse: 'Agent Server 回答',
        persistenceRoot: join(root, 'sessions'), cwd: root, apiKeyEnv: 'DEEPSEEK_API_KEY',
        maxSteps: 3, sandboxMode: 'read-only', approvalPolicy: 'never',
    });
    const server = new AgentServer(await HeadlessHost.open(profile), { authToken: token });
    const address = await server.listen();
    console.log('监听地址：', address);
    const rpc = async (id, method, params) => {
        const response = await fetch(`${address.url}/rpc`, {
            method: 'POST',
            headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        });
        return response.json();
    };
    console.log('创建结果：', await rpc('1', 'session.create', { sessionId: 'demo' }));
    console.log('发送结果：', await rpc('2', 'session.send', { sessionId: 'demo', text: '解释架构' }));
    const snapshot = await rpc('3', 'session.snapshot', { sessionId: 'demo' });
    console.log('快照事件数量：', snapshot.result?.events?.length);
    await server.close();
}
finally {
    await rm(root, { recursive: true, force: true });
}
//# sourceMappingURL=agent-server-demo.js.map