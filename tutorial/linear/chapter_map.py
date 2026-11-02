"""先展示本节目录，再用文件与函数调用图解释多文件接线；不扫描仓库外目录。"""

from functools import lru_cache
from pathlib import Path, PurePosixPath
import re


ROOT = Path(__file__).resolve().parent
# 箭头标明实际调用、进程启动或尚未接入，不能把 import 依赖冒充运行时调用。
CALLS = {
    '000': [('终端', 'bun run start 与任务参数', 'src/main.mjs：input(argv)'),
            ('tests/000-entry.test.mjs', '函数断言；spawnSync 验收子 CLI', 'src/main.mjs：input(argv)')],
    '005': [('src/session-demo.mjs', 'createReaderApp', 'src/session-app.mjs'),
            ('tests/005-session.test.mjs', '创建临时目录并调用 createReaderApp', 'src/session-app.mjs'),
            ('src/session-app.mjs', 'readTask 读取文件并追加事实', 'src/events.mjs：append → persist → 发布事件')],
    '013': [('src/demo.mjs', 'new Agent；submit；idle', 'src/agent.mjs'),
            ('tests/013-agent.test.mjs', '提交、排队、取消', 'src/agent.mjs'),
            ('src/agent.mjs', '取 Inbox 输入，调用 runTurn', 'src/loop.mjs')],
    '014': [('tests/014-batch.test.mjs', '批量调度固定任务', 'src/batch.mjs'),
            ('src/loop.mjs', 'tools.batch 存在时才走批处理', 'src/batch.mjs：安装后提供 batch')],
    '016': [('tests/016-deepseek.test.mjs', '注入固定 fetcher', 'src/deepseek.mjs：stream'),
            ('src/demo.mjs', '离线样本驱动', 'src/loop.mjs：runTurn'),
            ('src/live-demo.mjs', '显式选择真实模型', 'src/loop.mjs：runTurn'),
            ('src/loop.mjs：runTurn', '请求模型，执行工具后续轮', 'src/deepseek.mjs：stream'),
            ('src/deepseek.mjs：stream', '解析 SSE 字节', 'src/sse.mjs')],
    '018': [('src/routes-demo.mjs', '装配 Routes 与 Agent，submit', 'src/agent.mjs'),
            ('src/agent.mjs', 'runTurn 请求 model.stream', 'src/routes.mjs：Routes.stream'),
            ('src/routes.mjs：Routes.stream', '选择路由、重试与 RefreshToken', 'src/deepseek.mjs'),
            ('tests/018-routes.test.mjs', '单独测试路由与刷新', 'src/routes.mjs：Routes.stream')],
    '020': [('src/pi-demo.mjs', '装配 Agent 与 Routes', 'src/routes.mjs'),
            ('src/routes.mjs', '调用所选模型的 stream', 'src/pi.mjs：PiModel'),
            ('tests/020-pi.test.mjs', '注入适配器事件', 'src/pi.mjs：PiModel'),
            ('src/pi.mjs：PiModel', '上下文转换与流事件映射', 'pi-ai 提供方 API')],
    '022': [('src/edit-demo.mjs', '注册工具并驱动调用', 'src/file-tools.mjs：edit'),
            ('tests/022-edit.test.mjs', '版本、匹配数量与替换断言', 'src/file-tools.mjs：edit'),
            ('src/file-tools.mjs：edit', 'read → 版本比较 → write', 'src/filesystem.mjs：LocalFS')],
    '025': [('tests/025-process.test.mjs', 'execute(spec, signal)', 'src/process.mjs'),
            ('src/process.mjs', 'spawn 与输出收集', '外部命令进程'),
            ('src/process.mjs', '取消、超时后终止并等待 close', '外部命令进程')],
    '026': [('tests/026-shell.test.mjs', '构造 Shell 并顺序 run', 'src/shell.mjs'),
            ('src/shell.mjs', 'stdin 写命令和退出标记', 'Bash 子进程'),
            ('Bash 子进程', 'stdout 返回输出和标记', 'src/shell.mjs')],
    '027': [('tests/027-terminal.test.mjs', '创建 Terminal、发送 Vim 按键', 'src/terminal.mjs'),
            ('src/terminal.mjs', 'PTY 启动与按键写入', 'Vim 外部进程'),
            ('Vim 外部进程', '终端输出与退出', 'src/terminal.mjs')],
    '032': [('tests/032-rpc-demo.test.mjs', 'spawnSync 自动验收', 'src/rpc-demo.mjs：父进程'),
            ('src/rpc-demo.mjs：父进程', 'Peer.request，经 stdio', 'src/rpc-worker.mjs：子进程'),
            ('src/rpc-worker.mjs：子进程', '反向 approval/request', 'src/rpc-demo.mjs：父进程'),
            ('src/rpc-demo.mjs：父进程', 'Peer 与 framing 接线', 'src/rpc.mjs'),
            ('src/rpc-worker.mjs：子进程', 'Peer 与 framing 接线', 'src/rpc.mjs')],
    '033': [('tests/033-mcp.test.mjs', 'mountMCP', 'src/mcp.mjs'),
            ('src/mcp.mjs', 'StdioClientTransport 启动并握手', 'tests/fixtures/mcp.mjs：子进程'),
            ('src/mcp.mjs', 'listTools 后 register', 'src/tools.mjs'),
            ('src/tools.mjs', '工具 run 调用 client.callTool', 'tests/fixtures/mcp.mjs：子进程')],
    '035': [('tests/035-lsp.test.mjs', '构造 LSP、open、query', 'src/lsp.mjs：父侧'),
            ('src/lsp.mjs：父侧', 'spawn；Content-Length 请求', 'tests/fixtures/lsp.mjs：子服务'),
            ('tests/fixtures/lsp.mjs：子服务', '响应原请求 id', 'src/lsp.mjs：父侧'),
            ('src/lsp.mjs：父侧', 'Peer 与 framing', 'src/rpc.mjs')],
    '036': [('src/subagents-demo.mjs', '注册委派工具并提交父任务', 'src/subagent-tools.mjs'),
            ('src/subagent-tools.mjs', 'create、send、wait', 'src/subagents.mjs'),
            ('src/subagents.mjs', '创建逻辑子 Agent，仍在同一 Bun 进程', 'src/agent.mjs'),
            ('tests/036-subagent-tools.test.mjs', '断言工具委派闭环', 'src/subagent-tools.mjs')],
    '039': [('src/collaboration-demo.mjs', 'set、feedback、events、state', 'src/collaboration.mjs'),
            ('tests/039-collaboration.test.mjs', '验证事件和最新状态', 'src/collaboration.mjs'),
            ('src/collaboration.mjs', 'append 独立事件', 'src/events.mjs'),
            ('src/collaboration-demo.mjs', 'messages 投影，不把 todo 当对话', 'src/projection.mjs')],
    '041': [('src/host-demo.mjs', 'create、closeSession、重建、open', 'src/host.mjs'),
            ('tests/041-host.test.mjs', '验证恢复和失败清理', 'src/host.mjs'),
            ('src/host.mjs', 'open 时读取日志，创建 Agent', 'src/journal.mjs 与 src/agent.mjs')],
    '044': [('src/sdk-demo.mjs', 'new HarnessSDK；create；run；close', 'src/sdk.mjs：父侧'),
            ('tests/044-sdk.test.mjs', '固定离线模型验收', 'src/sdk.mjs：父侧'),
            ('src/sdk.mjs：父侧', 'spawn Bun，经 stdio 请求', 'src/sdk-server.mjs：子进程'),
            ('src/sdk-server.mjs：子进程', 'remote(peer, host)', 'src/remote.mjs'),
            ('src/remote.mjs', '领域方法访问 Host', 'src/host.mjs')],
    '045': [('tests/045-python.test.mjs：Bun 父测试', 'spawnSync Python fixture', 'tests/fixtures/python-sdk.py'),
            ('tests/fixtures/python-sdk.py', 'HarnessSDK.run', 'python/harness_sdk.py'),
            ('python/harness_sdk.py', 'Popen Bun，stdin JSON 请求', 'src/sdk-server.mjs：Bun 子进程'),
            ('src/sdk-server.mjs：Bun 子进程', 'remote 方法驱动', 'src/host.mjs'),
            ('src/sdk-server.mjs：Bun 子进程', 'stdout 响应交给 Python 读取线程', 'python/harness_sdk.py')],
    '046': [('tests/046-acp.test.mjs：客户端', 'spawn 并连接 ACP JSON 流', 'src/acp-server.mjs：子进程'),
            ('src/acp-server.mjs：子进程', 'acpApp(host).connect(stream)', 'src/acp.mjs'),
            ('src/acp.mjs', 'session/new → create；prompt → open 与 submit', 'src/host.mjs'),
            ('src/host.mjs', '事件转 update，审批转反向请求', 'src/acp.mjs'),
            ('src/acp.mjs', 'session/update 与 request_permission 经管道', 'tests/046-acp.test.mjs：客户端')],
    '047': [('tests/047-http.test.mjs', '同进程创建 Host 与 startHTTP', 'src/http.mjs'),
            ('src/web-server.mjs', '手工服务入口调用 startHTTP', 'src/http.mjs'),
            ('src/http.mjs', '认证通过后 remote(peer, host)', 'src/remote.mjs'),
            ('src/remote.mjs', '领域操作', 'src/host.mjs')],
    '049': [('src/web-server.mjs：Bun Host', 'startHTTP 提供资源与认证', 'src/http.mjs'),
            ('web/index.html：浏览器', '加载模块', 'web/app.mjs'),
            ('web/app.mjs', 'WebSocket rpc 请求', 'src/remote.mjs：Bun Host'),
            ('src/remote.mjs：Bun Host', '访问同进程 Host', 'src/host.mjs'),
            ('tests/049-web-assets.test.mjs', '只检查资源与路由，不驱动点击', 'src/http.mjs')],
    '050': [('src/web-server.mjs', '装配产品设置后 startHTTP', 'src/product.mjs'),
            ('web/app.mjs：浏览器', '设置、队列、文件 RPC', 'src/remote.mjs'),
            ('src/remote.mjs', '调用产品配置及领域操作', 'src/product.mjs'),
            ('tests/050-product.test.mjs', '模型与权限恢复断言', 'src/product.mjs')],
    '051': [('src/web-server.mjs', 'capabilities(host)', 'src/capabilities.mjs'),
            ('tests/051-capabilities.test.mjs', '直接验证工具注册与调用', 'src/capabilities.mjs'),
            ('src/capabilities.mjs', '注册 todo、plan 等工具', 'src/tools.mjs'),
            ('src/agent.mjs', '执行模型请求与工具循环', 'src/loop.mjs')],
    '052': [('终端 bun run desktop', '执行桌面启动器', 'scripts/desktop.mjs'),
            ('scripts/desktop.mjs', 'spawn Electron', 'desktop/main.cjs：Main'),
            ('desktop/main.cjs：Main', 'startHost，spawn Bun', 'src/web-server.mjs：Host'),
            ('desktop/main.cjs：Main', '创建窗口与固定 preload', 'desktop/preload.cjs：Renderer'),
            ('desktop/preload.cjs：Renderer', '隔离桥接供页面调用', 'web/app.mjs：Renderer'),
            ('tests/052-desktop-policy.test.mjs', '仅调用策略函数，不创建窗口', 'desktop/policy.mjs')],
    '053': [('tests/053-login.test.mjs', 'PKCE 与回调校验，固定 fetcher', 'src/login.mjs'),
            ('desktop/shortcuts.mjs', '本节测试未驱动，不承诺断点命中', '未接入本节验收的桌面快捷键入口')],
    '056': [('tests/056-release.test.mjs', '仅验证参数与凭据条件', 'scripts/release.mjs'),
            ('scripts/release.mjs', '实际发布需另行手动驱动', 'electron-builder.json：打包配置')],
    '058': [('tests/058-hooks.test.mjs', '安装 Hook 并调用受守卫工具', 'src/hooks.mjs'),
            ('src/hooks.mjs', 'execute 外部 Hook，再检查 reply.allow', 'src/process.mjs'),
            ('src/process.mjs', 'spawn', '外部 Hook 进程')],
    '059': [('tests/059-browser.test.mjs', '构造 Browser 并执行页面动作', 'src/browser.mjs'),
            ('src/browser.mjs', 'Playwright 连接外部 Chrome', 'Chrome 页面'),
            ('tests/059-browser.test.mjs', '系统参数与runner替身执行契约', 'src/computer.mjs'),
            ('src/computer.mjs', '自动测试不执行真实桌面输入', '未实测的系统权限与桌面动作')],
    '060': [('tests/060-audio.test.mjs', '固定 fetcher 验证识别和翻译', 'src/audio.mjs'),
            ('web/audio.mjs', '当前测试未接入麦克风', '尚未由本节证明的浏览器录音入口')],
    '061': [('scripts/send-webhook.mjs', '发送签名HTTP请求', 'src/webhook-http.mjs'),
            ('src/webhook-server.mjs', '创建真实Host和固定会话，启动监听', 'src/webhook-http.mjs'),
            ('src/webhook-http.mjs', '原始字节与请求头', 'src/webhook.mjs'),
            ('src/webhook.mjs', '写持久Inbox并pump', 'src/agent.mjs'),
            ('src/agent.mjs', '领取任务并运行模型循环', 'src/loop.mjs')],
    '063': [('tests/063-workers.test.mjs', 'workers.run 并检查额度', 'src/workers.mjs'),
            ('src/workers.mjs', 'new HarnessSDK，create/run/close', 'src/sdk.mjs'),
            ('src/sdk.mjs', 'spawn 独立 Bun Host', 'src/sdk-server.mjs'),
            ('src/sdk-server.mjs', '复用 remote 与 Host', 'src/host.mjs')],
    '066': [('tests/066-query.test.mjs', '索引、搜索、导出、导入', 'src/query.mjs'),
            ('tests/066-query.test.mjs', 'spawnSync tsc --noEmit', 'tests/types-sdk.mts'),
            ('tests/types-sdk.mts', '类型契约引用', 'types/sdk.d.ts')],
    '067': [('tests/067-comparison.test.mjs', '只调用 signature，不启动原版', 'scripts/compare-acp.mjs'),
            ('终端实际比较器', '显式提供原版目录后运行', 'scripts/compare-acp.mjs'),
            ('scripts/compare-acp.mjs', '独立启动自己的 ACP', 'tests/fixtures/own-acp.mjs'),
            ('scripts/compare-acp.mjs', '独立启动原版适配器', 'scripts/oracle-acp.mjs')],
    '068': [('tests/068-web-e2e.test.mjs：Bun', '创建同进程 Host 与 HTTP', 'src/http.mjs'),
            ('tests/068-web-e2e.test.mjs：Bun', 'Playwright 启动独立 Chrome', 'web/app.mjs：浏览器'),
            ('web/app.mjs：浏览器', 'WebSocket RPC', 'src/remote.mjs：Bun'),
            ('src/remote.mjs：Bun', '审批、工具与真实文件操作', 'src/host.mjs')],
    '069': [('终端或本节 CLI 配置', '任务参数', 'src/main.mjs'),
            ('tests/069-cli.test.mjs', 'spawnSync 子 CLI，仅观察输出', 'src/main.mjs'),
            ('src/main.mjs', '创建 Host，装配 product 与 capabilities', 'src/host.mjs'),
            ('src/main.mjs', 'submit → idle → 输出事件', 'src/agent.mjs')],
}


@lru_cache(maxsize=70)
def sources_at(number):
    """只累计到当前课次，目录图不得引用未来新增文件。"""
    sources = {}
    for index in range(int(number) + 1):
        directory = ROOT / 'steps' / f'{index:03}'
        for path in sorted(directory.rglob('*')):
            if path.is_file():
                sources[path.relative_to(directory).as_posix()] = path
    return sources


def map_files(lesson):
    """收集当前增量，以及调用图明确引用的前置文件，不展开无关目录。"""
    number = lesson['id']
    files = {path.relative_to(ROOT / 'steps' / number).as_posix(): '本节创建或替换'
             for path in (ROOT / 'steps' / number).rglob('*') if path.is_file()}
    for edge in CALLS.get(number, []):
        for label in (edge[0], edge[2]):
            for path in re.findall(r'(?:src|tests|python|desktop|scripts|web|types)/[\w./-]+\.(?:mjs|cjs|py|mts|html|ts)', label):
                if path not in sources_at(number):
                    raise ValueError(number + '调用图引用尚未实现的文件：' + path)
                files.setdefault(path, '沿用前置实现')
    return files


def directory_tree(files):
    """按真实路径生成目录树，每个文件标明本节增量还是前置依赖。"""
    tree = {}
    for path, role in sorted(files.items()):
        node = tree
        parts = PurePosixPath(path).parts
        for part in parts[:-1]:
            node = node.setdefault(part, {})
        node[parts[-1]] = role
    lines = ['PROJECT/']

    def visit(node, prefix):
        """递归画出分支，保证同名文件仍能看出所在目录。"""
        for index, (name, value) in enumerate(sorted(node.items())):
            last = index == len(node) - 1
            lines.append(prefix + ('└── ' if last else '├── ') + name + ('/' if isinstance(value, dict) else '  # ' + value))
            if isinstance(value, dict):
                visit(value, prefix + ('    ' if last else '│   '))
    visit(tree, '')
    return '\n'.join(lines)


def call_graph(number):
    """将逐条核对的文件与方法调用转成 Mermaid；箭头文字标出驱动边界。"""
    labels = list(dict.fromkeys(label for edge in CALLS[number] for label in (edge[0], edge[2])))
    identities = {label: 'F' + str(index) for index, label in enumerate(labels)}
    lines = ['flowchart TD']
    lines += ['    ' + identities[label] + '["' + label.replace('"', '&quot;') + '"]' for label in labels]
    for source, action, target in CALLS[number]:
        lines.append('    ' + identities[source] + ' -->|"' + action.replace('"', '&quot;') + '"| ' + identities[target])
    return '\n'.join(lines)


def render_map(lesson):
    """仅在多文件接线章节插入概览，结构与调用先于源码展开。"""
    number = lesson['id']
    if number not in CALLS:
        return ''
    files = map_files(lesson)
    return '\n'.join(['## 先看目录与调用关系', '',
                      '目录只列本节文件及图中直接用到的前置实现；不是累计工程的完整文件清单。', '',
                      '```text', directory_tree(files), '```', '',
                      '### 本节入口怎样调用这些文件', '',
                      '箭头写明实际调用或进程启动；标为“未接入”的文件不是本节测试能命中的目标。', '',
                      '```mermaid', call_graph(number), '```', ''])
