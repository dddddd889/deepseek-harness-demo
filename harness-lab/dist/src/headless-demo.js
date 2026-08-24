import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HeadlessHost } from "./headless-host.js";
import { validateProfile } from "./profile.js";
const root = await mkdtemp(join(tmpdir(), 'harness-headless-demo-'));
try {
    const profile = validateProfile({
        name: 'debug-headless', provider: 'scripted', model: 'fixture',
        scriptedResponse: '这是离线可重复的 Headless 回答。',
        persistenceRoot: join(root, 'sessions'), cwd: root, apiKeyEnv: 'DEEPSEEK_API_KEY',
        maxSteps: 3, sandboxMode: 'read-only', approvalPolicy: 'never',
    });
    const firstHost = await HeadlessHost.open(profile);
    console.log('插件包：', firstHost.bundle.context.inspect());
    const first = await firstHost.create('demo-session');
    console.log('第一轮：', await first.run('第一轮'));
    await first.close();
    await firstHost.dispose();
    const resumedHost = await HeadlessHost.open(profile);
    const resumed = await resumedHost.resume('demo-session');
    console.log('恢复后：', await resumed.run('第二轮'));
    await resumed.close();
    await resumedHost.dispose();
}
finally {
    await rm(root, { recursive: true, force: true });
}
//# sourceMappingURL=headless-demo.js.map