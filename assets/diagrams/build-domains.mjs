import { renderDomains } from './domain-connections.mjs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// 领域数据同时生成页面、SVG 和 Mermaid；源码路径以原实现为准。
const root = fileURLToPath(new URL('../../', import.meta.url));
const groups = [
  { id: 'frontend', title: '前端与客户端', color: '#e6f3ff', relation: '模块加载装配插件；运行时接收连接事件；React 将状态与插槽贡献渲染为业务界面。', nodes: [
    ['应用外壳与插件装配', 'Web 外壳、Cordis、模块加载与 HMR', '外壳启动客户端 Cordis；modules 加载插件，HMR 负责卸载与重载。插件热更新不是会话事件推送。', 'packages/client/modules/README.zh.md'],
    ['通信与连接生命周期', 'HTTP 调用、双 WebSocket、重连', 'connection 管理连接代次和握手；业务调用走 HTTP，下行使用 events.mux 与 events.host 两条 WebSocket。', 'packages/client/connection/README.zh.md'],
    ['会话与工作区状态', 'Session、Workspace、分页与投影', 'SessionRuntime 和 WorkspaceRuntime 管理客户端对象、列表及事件镜像；历史分页和 ProjectionValueStore 不等于持久化数据库。', 'packages/client/runtime/README.zh.md'],
    ['UI 扩展与 React 渲染', 'Slot 注册、状态订阅、渲染器', 'ui-slots 声明 UI 扩展约定；运行时提供状态源，web-react 绑定订阅与渲染。组件不是通信层。', 'packages/client/ui-slots/README.zh.md'],
    ['对话与任务界面', '输入、消息、工具轨迹、审批与子任务', '业务插件呈现对话、工具结果、待审批或待回答操作，以及子智能体、Jobs、Workflow 状态；实际执行仍在服务端。', 'packages/client/ui-conversation/README.zh.md'],
    ['工作台与偏好界面', '侧栏、工作区、模型、设置与主题', '侧栏和工作区组织会话；模型选择、设置、主题与语言由相应插件贡献。设置界面不持有提供方执行能力。', 'packages/client/ui-settings/README.zh.md'],
  ]},
  { id: 'server', title: '后端：服务接入层（Agent Server 职责）', color: '#f0edff', relation: '浏览器 → HTTP / WebSocket 载体 → 协议与对象解析 → 业务服务；推送反向送回客户端。', nodes: [
    ['Web 宿主与资源服务', 'Webserver、静态前端、插件资源', 'Web 宿主提供 HTTP 服务、前端静态资源和插件资源；原实现不是一个包办一切的 AgentServer 类。', 'packages/host/webserver/README.zh.md'],
    ['远程调用网关', 'Typert、Remote 方法与身份解析', 'Gateway 暴露显式声明的 Remote 方法，将 wire identity 解析为 Host 对象或作用域，再调用拥有该能力的服务。', 'docs/api-gateway.zh.md'],
    ['会话操作与历史入口', '创建、输入、取消、历史与查询', '接入层把会话操作交给运行时或查询服务；history 可能恢复尚未附加的会话，不能假定它永远只读数据库。', 'packages/client/connection/README.zh.md'],
    ['实时事件下行', '会话复用流、Host 流、投影推送', 'events.mux 与 events.host 分别传递对应的服务端帧；浏览器不在这些 WebSocket 上发送业务请求。', 'packages/client/connection/README.zh.md'],
    ['访问与协议边界', '来源检查、请求限制、作用域校验', 'Web 载体的浏览器访问限制不是完整认证系统；远程方法声明和对象解析也不能替代部署层安全设计。', 'packages/client/connection/README.zh.md'],
    ['无界面与 SDK 入口', 'Headless 装配、程序化调用', 'Headless 使用同一核心能力建立持久 Agent，但不需要经过 Web 接入层。SDK 入口与浏览器产品载体不混为一谈。', 'packages/bundle/headless/README.zh.md'],
  ]},
  { id: 'core', title: '后端：智能体核心与编排', color: '#f0edff', relation: '输入进入 Inbox → Turn / Step 推进 → 上下文与模型 / 工具交互 → Session 记事实 → 投影消费。', nodes: [
    ['智能体与运行生命周期', 'Agent 注册、创建、恢复、释放', 'Agent 接口与注册表提供运行对象；agent-loop 是具体驱动器。恢复入口调用持久化服务，而不是从观测平台重建。', 'packages/core/agent-loop/README.zh.md'],
    ['循环与输入调度', 'Inbox、Turn、Step、取消与收尾', 'Loop 领取输入、推进模型与工具步骤并处理停止；Turn 与 Step 是持久事件边界，不只是界面上的一条消息。', 'packages/core/agent-loop/README.zh.md'],
    ['会话事实与读模型', 'Session、事件协议、Surface、投影', 'Session 保存有序事实；模型历史与客户端读模型分别派生。消息呈现、原始事件、统计投影不是同一种数据。', 'packages/core/session/README.zh.md'],
    ['上下文工程', '提示词、指令、Token、压缩与修剪', '系统提示词与工具 schema 组装后参与请求；Token 测量、Compaction 和结果修剪控制上下文，外置产物由存储能力承接。', 'docs/capability-seams.zh.md'],
    ['子智能体与后台任务', '委派、继续、结果回传、Jobs', 'subagents 提供创建与继续接口；Jobs 登记后台工作。两者的对象和生命周期不同，不统一简化为一次工具调用。', 'docs/capability-seams.zh.md'],
    ['工作流与目标控制', 'Workflow、Goal、计划与交互状态', '工作流引擎负责脚本编排；目标、计划、用户问题等插件参与运行控制。具体能力是否启用取决于装配。', 'docs/capability-seams.zh.md'],
  ]},
  { id: 'execution', title: '模型、工具与执行环境', color: '#fff3dc', relation: 'Loop 调模型或工具；工具经审批 / 策略约束后调用能力后端；结果返回 Session 与下一步上下文。', nodes: [
    ['模型适配与流式协议', '适配器、请求配置、分片与用量', 'LLM 服务注册适配器，固定单次调用配置；分片、完成与用量按协议返回。模型选择界面不直接执行提供方请求。', 'packages/llm/llm/README.zh.md'],
    ['工具注册与执行管线', 'Schema、前置检查、执行、结果处理', 'ToolRuntime 统一注册和执行；pre-execute、guard、execute、post-execute 等阶段分离策略和能力实现。', 'packages/core/tools/README.zh.md'],
    ['审批、权限与隔离', '用户批准、策略、进程沙箱', 'approval 等待用户决策，sandboxPolicy 表达策略，sandbox 约束进程。用户点击允许不意味着跳过全部执行限制。', 'docs/capability-seams.zh.md'],
    ['本地与远程执行后端', '文件、子进程、Shell、PTY、E2B', '文件系统、进程和终端各有服务边界，可选择本地或隔离环境实现；工作目录内容与会话记录独立存在。', 'docs/capability-seams.zh.md'],
    ['外部工具与知识接入', 'MCP、Skills、Web、LSP', 'MCP 接入工具，Skills 提供技能内容，Web 与 LSP 有各自服务接口；它们不是同一个网络调用层。', 'docs/capability-seams.zh.md'],
    ['结果与大内容处理', '附件引用、Spill、工具结果修剪', '执行结果可携带附件或外置引用；保留、修剪和存储职责分离。重放引用不会自动重新执行工具来补内容。', 'docs/capability-seams.zh.md'],
  ]},
  { id: 'storage', title: '数据库与持久化', color: '#e6f3ff', relation: 'Session → 持久化接口 → SQLite 或 JSONL；查询索引从事实派生，资源内容和非会话数据另行保存。', nodes: [
    ['会话持久化接口', '会话头、事件、刷盘屏障', 'SessionPersistence 定义追加、加载、列举和持久化屏障；逻辑事实约定独立于物理格式。', 'packages/session/session-persistence/README.zh.md'],
    ['权威存储后端', 'SQLite 或 JSONL，按装配选择', 'SQLite 将头与事件存入 sessions / events 表，以事务提交；JSONL 是另一种实现。默认选择 JSONL 不代表 SQLite 只能做缓存。', 'packages/session/session-persistence-sqlite/README.zh.md'],
    ['恢复、修复与分叉', '加载历史、关闭中断轮次、继承种子', '恢复从配置的后端读取，并处理崩溃留下的轮次；Fork 保留谱系与继承边界。未知工具结果不应盲目重试。', 'packages/session/session-persistence/README.zh.md'],
    ['派生查询与搜索', '独立 SQLite 索引，可重建', 'session-query-sqlite 管理派生索引，不承担权威持久化；不能指向会话存储数据库，默认组合不启用内容搜索。', 'packages/session-query/session-query-sqlite/README.zh.md'],
    ['非会话数据与配置', '领域 KV、设置、凭据各有接口', 'ctx.storage 路由非会话领域 KV 的 JSON / SQLite 后端；settings 与 credentials 是另外的服务边界，不能把所有配置都说成存入事件表。', 'docs/capability-seams.zh.md'],
    ['附件与溢出产物', '二进制内容、外置文件、引用解析', 'attachments 与 spillStore 管理实际内容；事件记录引用。备份和恢复需覆盖被引用产物，不只是 events 表。', 'docs/capability-seams.zh.md'],
  ]},
  { id: 'observability', title: 'OTel 与可观测性', color: '#e7f5ef', relation: '捕获 → 投影与脱敏 → OTel Logs SDK → OTLP 接收端；用量统计是另一条读模型分支。', nodes: [
    ['事件与运维信号捕获', '会话记录、错误、关闭信号', '遥测协调器捕获会话事实副本和运维记录；实时跟随或按需回放由后端模式决定，不改变原始会话事实。', 'packages/session/session-telemetry/README.zh.md'],
    ['投影、脱敏与分享策略', '全量、反馈触发、禁用', '默认 DISABLED；FULL 全量跟随，FEEDBACK_ONLY 按已记录反馈触发。脱敏是扩展点，默认没有规则，部署方须自行配置。', 'packages/session/session-telemetry-otel/README.zh.md'],
    ['OTel Logs 导出管线', '日志 SDK、批处理、OTLP 导出', '记录交给 OTel SDK 的日志管线，经 OTLP/HTTP 导出；排队、重试及丢失策略属于 SDK。不是把恢复记录直接搬进 Trace。', 'packages/session/session-telemetry-otel/README.zh.md'],
    ['接收与观测存储', '部署方端点、去重、分析与告警', '接收端由部署方配置，不能假定已部署某个 Collector 或数据库；观测副本可能缺失，不是会话恢复依据。', 'packages/session/session-telemetry-otel/README.zh.md'],
    ['用量、成本与统计读模型', '原始用量、会话汇总、界面展示', '用量等原始字段随事件保存，相应消费者计算展示值；sessionStats 提供轮步与时延统计，不应称为完整财务结算账本。', 'packages/session/session-stats/README.zh.md'],
    ['运行时诊断与不变量', '一致性检查、失败定位与边界验证', 'invariants 提供包拥有的不变量注册，帮助定位运行时违约；测试与发布检查属于工程底座，不归 OTel 导出器负责。', 'packages/runtime-diagnostics/invariants/README.zh.md'],
  ]},
  { id: 'foundation', title: '工程、装配与交付底座', color: '#f2f4f7', relation: '以下能力横切前述领域，不是请求必须经过的最后一站；课程使用 VS Code 调试，原实现按自身工具链构建。', nodes: [
    ['插件依赖与资源生命周期', 'Cordis、服务注入、作用域与释放', '各领域以插件贡献服务和可逆副作用；插件卸载撤销对应注册，不需要修改一个特权内核。', 'docs/architecture.zh.md'],
    ['产品装配与配置覆盖', '配置档、组合包、覆盖层', 'Profile、Bundle、Patch 叠加：base、web-app、headless 和配置覆盖决定实际启用能力；图中的能力目录不表示每次启动都全部挂载。', 'docs/architecture.zh.md'],
    ['构建与协议生成', 'Host / Client 构建、Typert 生成', '构建产物与远程协议生成确保两端接口匹配；客户端模块加载消费已构建的插件资源。', 'docs/api-gateway.zh.md'],
    ['自动测试与回归', '单元、集成、端到端、故障场景', '原仓库与实验室分别使用自身测试入口；课程逐步加入取消、崩溃、重连与恢复等回归场景，不等于已验证所有生产组合。', 'package.json'],
    ['本地开发与断点调试', '课程 VS Code 配置、状态检查', '课程入口用 VS Code 启动调试，结合断点、事件和状态产物检查行为；客户端 HMR 是另一条开发辅助链路。', 'packages/client/hmr/README.zh.md'],
    ['发布与运维检查', '构建产物、配置、安全与备份边界', '课程交付检查覆盖各领域；数据库和产物备份、遥测授权与访问限制需要分别核对，不能以一个绿色测试代替全部验证。', 'docs/architecture.zh.md'],
  ]},
];

// 转义所有生成内容，空值保持短横线占位。
const escape = value => String(value ?? '-').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
// 文本换行使用独立 SVG text，保证离线查看时位置稳定。
function words(x, y, value, size, limit = 60) {
  const lines = [];
  for (let start = 0; start < value.length; start += limit) lines.push(`<text x="${x}" y="${y + lines.length * 23}" font-size="${size}">${escape(value.slice(start, start + limit))}</text>`);
  return lines.join('');
}
// 图像和关系表共用连线模型，SVG 不再退化为没有关系的领域目录。
const drawing = renderDomains(groups);
const svg = [drawing.svg], mermaid = [drawing.mermaid];
const html = ['    <!-- 领域子系统：开始 -->', '    <nav aria-label="技术领域分支导航">' + groups.map(group => '<a href="#domain-' + group.id + '">' + group.title + '</a>').join(' · ') + '</nav>', '    <p>保留七个领域与 42 个子系统分支；总图增加 48 条内部和跨领域连线。实线分别表示请求、事件回传和存储关系；虚线表示遥测或横切支撑。分支不是执行顺序，连线也不是全部源码依赖。</p>', drawing.connections];
for (const [index, group] of groups.entries()) {
  html.push('    <article id="domain-' + group.id + '" class="domain-detail"><h3>' + (index + 1) + '. ' + group.title + '</h3>', '    <p><strong>内部关系：</strong>' + group.relation + '</p>', '    <table><thead><tr><th>子系统分支</th><th>职责与边界</th><th>实现依据</th></tr></thead><tbody>');
  for (const [title, , description, source] of group.nodes) {
    html.push('      <tr><th scope="row">' + title + '</th><td>' + description + '</td><td><a href="../deepseek-harness/' + source + '">' + source.split('/').slice(-2).join('/') + '</a></td></tr>');
  }
  html.push('    </tbody></table></article>');
}
html.push('    <!-- 领域子系统：结束 -->');
// 输出补丁而不直接覆写页面；由调用方 apply_patch 应用，保留区块之外的现有内容。
const pagePath = 'reference/deepseek-harness-build-roadmap.html';
const oldPage = await readFile(root + pagePath, 'utf8');
const block = html.join('\n') + '\n';
const marker = '    <h3>数据库不是只有一种角色</h3>';
const oldBlock = oldPage.match(/    <!-- 领域子系统：开始 -->[\s\S]*?    <!-- 领域子系统：结束 -->\n/);
const newPage = oldBlock ? oldPage.replace(oldBlock[0], block) : oldPage.replace(marker, block + marker);
const changes = [[pagePath, oldPage, newPage], ...await Promise.all([['svg', svg.join('')], ['mmd', mermaid.join('\n')]].map(async ([extension, contents]) => {
  const path = `assets/diagrams/architecture-domains.${extension}`;
  return [path, await readFile(root + path, 'utf8'), contents];
}))];
const patches = changes.filter(([, before, after]) => before !== after).map(([path, before, after]) => `*** Update File: ${root + path}\n@@\n${before.trimEnd().split('\n').map(line => '-' + line).join('\n')}\n${after.trimEnd().split('\n').map(line => '+' + line).join('\n')}`);
console.log(patches.length ? '*** Begin Patch\n' + patches.join('\n') + '\n*** End Patch' : '领域图文已同步，无需更新。');
