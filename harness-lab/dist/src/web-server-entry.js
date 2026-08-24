#!/usr/bin/env bun
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentServer } from "./agent-server.js";
import { LocalAttachmentStore } from "./attachment-store.js";
import { HeadlessHost } from "./headless-host.js";
import { InteractionBroker } from "./interactions.js";
import { loadProfile } from "./profile.js";
const profilePath = process.argv[2];
const token = process.env.DSH_LAB_AUTH_TOKEN;
if (token === undefined)
    throw new Error('缺少 DSH_LAB_AUTH_TOKEN（至少 16 字符）');
const profile = await loadProfile(profilePath);
const interactions = new InteractionBroker();
const attachments = new LocalAttachmentStore(dirname(profile.persistenceRoot), {
    maxImageBytes: 10 * 1024 * 1024, maxImagePixels: 40_000_000,
    mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
});
const host = await HeadlessHost.open(profile, undefined, interactions);
const server = new AgentServer(host, {
    host: process.env.DSH_LAB_HOST ?? '127.0.0.1',
    port: Number(process.env.DSH_LAB_PORT ?? '0'),
    authToken: token, interactions, attachments,
    webRoot: join(dirname(fileURLToPath(import.meta.url)), '../web'),
});
const address = await server.listen();
process.stdout.write(`DeepSeek Harness 实验室网页服务：${address.url}\n`);
await new Promise(resolve => {
    let stopping = false;
    const stop = () => {
        if (stopping)
            return;
        stopping = true;
        void server.close().finally(resolve);
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
});
//# sourceMappingURL=web-server-entry.js.map