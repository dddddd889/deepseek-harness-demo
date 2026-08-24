import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CapabilityCatalog } from "./capability-catalog.js";
import { LspRuntime } from "./lsp-runtime.js";
import { McpToolBridge } from "./mcp-bridge.js";
import { SkillRegistry } from "./skills.js";
import { ToolRegistry } from "./tools.js";
import { WebRuntime } from "./web-runtime.js";
const root = await mkdtemp(join(tmpdir(), 'harness-capabilities-demo-'));
try {
    const skillDir = join(root, 'skills', 'explain');
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, 'SKILL.md'), '---\nname: explain\ndescription: 解释代码\n---\n先定位符号，再解释调用关系。');
    const skills = new SkillRegistry([{ path: join(root, 'skills'), rank: 100, provider: 'project' }]);
    await skills.refresh();
    const tools = new ToolRegistry();
    const mcp = new McpToolBridge('docs', {
        listTools: async () => ({ tools: [{ name: 'lookup', description: '查文档', inputSchema: { type: 'object' } }] }),
        callTool: async (name, args) => ({ serverReceivedRawName: name, args }),
    }, tools);
    await mcp.sync();
    const web = new WebRuntime();
    web.registerSearch({
        id: 'fake-search', available: () => true,
        search: async (query) => ({ sources: [{ url: 'https://example.test', title: query }], truncated: false }),
    });
    const lsp = new LspRuntime();
    lsp.register({
        id: 'fake-ts', extensionToLanguage: { '.ts': 'typescript' },
        query: async (request) => ({ kind: 'hover', contents: `${request.languageId}@${request.line}:${request.character}` }),
    });
    const catalog = new CapabilityCatalog();
    for (const skill of skills.list())
        catalog.register({ kind: 'skill', id: skill.name, provider: skill.provider, description: skill.description });
    for (const tool of tools.schemas())
        catalog.register({ kind: 'tool', id: tool.name, provider: 'mcp:docs', description: tool.description });
    catalog.register({ kind: 'web-search', id: 'fake-search', provider: 'fake-search', description: '离线可调试搜索' });
    catalog.register({ kind: 'lsp', id: 'fake-ts', provider: 'fake-ts', description: '离线可调试 LSP' });
    console.table(catalog.list());
    console.log('按需加载 skill:', await skills.get('explain'));
    console.log('Web:', await web.search('DeepSeek Harness', 3));
    console.log('LSP:', await lsp.query({ operation: 'hover', filePath: 'src/a.ts', line: 3, character: 5, workspaceRoot: root }));
}
finally {
    await rm(root, { recursive: true, force: true });
}
//# sourceMappingURL=capabilities-demo.js.map