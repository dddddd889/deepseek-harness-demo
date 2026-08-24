import assert from 'node:assert/strict';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HarnessBundle } from "./bundle.js";
import { Session } from "./session.js";
import { JsonlSessionStore } from "./session-store.js";
/** 编译产物冒烟：验证插件内核与持久化冷恢复，不依赖外网密钥。 */
const root = await mkdtemp(join(tmpdir(), 'dsh-release-smoke-'));
try {
    const bundle = new HarnessBundle();
    await bundle.mount([{ name: 'smoke', apply: async (ctx) => ctx.provide('ready', true) }]);
    assert.equal(bundle.context.get('ready'), true);
    await bundle.dispose();
    const store = await JsonlSessionStore.open(root);
    const { session } = await store.create('release-smoke', process.cwd());
    session.append('turn/start', { turn: 1 });
    await store.flush(session);
    await store.close(session);
    const recovered = await store.resume('release-smoke');
    assert.equal(recovered.session.events.length, 2);
    assert.equal(recovered.repair.syntheticClosers, 1);
    await store.close(recovered.session);
    await access(new URL('../web/index.html', import.meta.url));
    process.stdout.write('release smoke: ok\n');
}
finally {
    await rm(root, { recursive: true, force: true });
}
//# sourceMappingURL=release-smoke.js.map