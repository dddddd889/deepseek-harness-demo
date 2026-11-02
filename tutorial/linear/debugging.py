"""逐课生成调试入口与启动说明；只列当步代码实际能够到达的目标。"""

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent
# 这些章节有同进程的可运行演示；不因为前序存在某个文件就继续展示旧入口。
DEMOS = {
    '005': ('005：读文件演示', 'src/session-demo.mjs'),
    '013': ('013：Agent演示', 'src/demo.mjs'),
    '036': ('Bun：036父Agent工具委派', 'src/subagents-demo.mjs'),
    '039': ('Bun：039独立事件记录', 'src/collaboration-demo.mjs'),
    '041': ('041：会话管理演示', 'src/host-demo.mjs'),
    '044': ('044：SDK运行演示', 'src/sdk-demo.mjs'),
}
ATTACH_DEMOS = {
    '018': ('Bun：018路由演示（附加）', 'src/routes-demo.mjs', 'routes-018'),
    '020': ('Bun：020 pi-ai（附加）', 'src/pi-demo.mjs', 'pi-020'),
    '022': ('Bun：022文件替换（附加）', 'src/edit-demo.mjs', 'edit-022'),
}
# 普通测试会启动外部执行目标，但父调试器不会自动跨进程；按实测驱动说明边界。
EXTERNAL_TESTS = {
    '000': ('CLI 子进程', '测试的 spawnSync 检查命令行退出码；直接调 main 请选本节 CLI 入口。'),
    '018': ('演示子进程', 'CLI 验收会另起演示；实际模型路由变量用本节 demo 附加会话观察。'),
    '020': ('演示子进程', '当前测试只直接观察 PiModel 适配器；完整 demo 是另一个进程。'),
    '022': ('演示子进程', '文件编辑测试可在父进程单步；CLI 演示若另起进程，需要单独附加。'),
    '025': ('外部命令', '本节调试 Bun 的进程管理与输出收集，外部命令不属于父进程调用栈。短超时断言请连续运行。'),
    '026': ('Bash 子进程', '本节看写管道、标记与退出；Bun 调试器不能进入 Bash，停顿超过脚本的 5 秒预算会超时。'),
    '027': ('PTY 与 Vim', '本节看 PTY 包装和按键前后的状态；Vim 不属于 Bun 调试会话，就绪检查只有数秒。'),
    '032': ('RPC 演示及 worker', '测试进程用 spawnSync 等演示结束。要看业务断点，请按本节父、子 Attach 顺序启动。'),
    '033': ('MCP fixture', '普通测试只附加父侧。子服务断点需先安装文末的调试扩展文件，再启用 MCP_DEBUG。'),
    '035': ('LSP fixture', '普通测试只附加父侧。文末调试扩展分别调整测试、RPC 和 shutdown 的等待预算。'),
    '044': ('Bun SDK Host', 'SDK 父进程负责协议客户端；Host/Agent 在子进程，只有等待附加模式才开放子 Inspector。'),
    '045': ('Python，再由 Python 启动 Bun Host', 'Bun 测试、Python 客户端和 Bun Host 是三个进程；Python 断点要用 debugpy 单独启动。'),
    '046': ('ACP Host', '父侧 ACP SDK 与服务端 Host 分处两个 Bun 进程；打印消息不等于已附加服务端。'),
    '058': ('Hook 命令', '测试观察 Hook 的执行与拒绝，F11 不能进入外部 Hook 脚本；不会启动 Electron。'),
    '059': ('Chrome', '本节是 Playwright 客户端的 Bun 断点，Chrome 中的页面 JS 需要自己的浏览器调试会话。'),
    '063': ('Worker 的 Bun Host', 'Workers 的额度与 SDK 调用在父侧，Agent 在另起的 Host 中，本节普通配置不自动附加。'),
    '066': ('TypeScript 编译检查', '查询与导出代码在父侧；tsc 是子进程，只核对它的 status，不把它当作本节业务断点。'),
    '068': ('Chrome', '自动测试把 Host 与 Playwright 客户端装在测试进程，另起 Chrome；手动页面配置不是它的那个浏览器。'),
    '069': ('CLI 子进程', '父测试只检查子 CLI 的输出与退出。要看 main、Host、工具内部，请直接用本节 CLI 入口。'),
}


def bun_launch(name, program, test=False, **extra):
    """生成 Bun 启动配置；测试固定文件，普通脚本不误带 test 参数。"""
    arguments = (['test'] if test else []) + ['--preload', '${workspaceFolder}/scripts/vscode-debug.mjs']
    if test:
        arguments += ['--timeout', '3600000']
    config = dict(name=name, type='bun', request='launch', program='${workspaceFolder}/' + program,
                  cwd='${workspaceFolder}', runtime='bun', runtimeArgs=arguments, stopOnEntry=False)
    config.update(extra)
    return config


def attach(name, url):
    """Attach 只连接已启动的进程，本身不负责创建服务。"""
    return dict(name=name, type='bun', request='attach', url=url)


def startup_sequence(actions):
    """生成启动时序，区分终端、调试器、父进程、外部执行目标。"""
    return '\n'.join([
        'sequenceDiagram', '    actor U as 学习者与终端', '    participant D as VS Code 调试器',
        '    participant P as 本节入口进程', '    participant C as 本节另一执行目标',
        *['    ' + action for action in actions],
    ])


def plan_for(lesson):
    """按课次组装可用配置、观察范围、启动顺序和必要前置。"""
    number = lesson['id']
    test_name = number + '：本节测试'
    test = bun_launch(test_name, lesson['test'], test=True)
    # 默认不继承前章的手动调试开关，避免普通测试停在另一个 Inspector 上。
    ordinary_switch = {'033': 'MCP_DEBUG', '035': 'LSP_DEBUG', '044': 'SDK_DEBUG_HOST', '063': 'SDK_DEBUG_HOST'}.get(number)
    if ordinary_switch:
        test['env'] = {ordinary_switch: '0'}
    configurations = [test]
    rows = [(test_name, '本节验收', lesson['test'], '本节 Bun 测试进程；入口固定，不依赖当前编辑器文件。')]
    inputs, actions, commands = [], [], []
    reason = '本节测试直接调用被测模块，选择这一项即可沿测试进入实现；前序 CLI 或其他语言入口不参与这次调试。'
    primary = test_name
    requirements = []

    def add(config, usage, target, scope):
        """同时登记真实配置和文档表格，避免二者各写一份后失配。"""
        configurations.append(config)
        rows.append((config['name'], usage, target, scope))

    if number in DEMOS:
        name, program = DEMOS[number]
        # 005的入口要求显式文件参数，不能只给程序路径后让启动必然报用法错误。
        arguments = {'args': ['package.json']} if number == '005' else {}
        add(bun_launch(name, program, **arguments), '本节演示', program, '直接运行本节演示；测试框架不介入。' + ('读取本项目 package.json。' if number == '005' else ''))
        if number != '044':
            primary = name
            reason = '先用本节演示看完整动作，再用固定测试检查断言；演示和它直接导入的模块在同一个 Bun 进程。'
    if number in ATTACH_DEMOS:
        name, program, route = ATTACH_DEMOS[number]
        add(attach(name, 'ws://127.0.0.1:6499/' + route), '本节演示', program, '终端先创建演示进程，再连接它的 Inspector。')
        commands = [f'bun --inspect-brk=127.0.0.1:6499/{route} {program}']
        reason = '固定测试和完整演示是两条不同驱动路径；Attach 连接终端启动的那一个 demo，避免误调仍停在第 000 步的 CLI。'
        actions = ['U->>P: 终端执行本节 inspect-brk 命令', 'P-->>U: Inspector 已监听，等待执行',
                   f'U->>D: 选择 {name} 并 F5', 'D->>P: 连接 Inspector，继续运行',
                   'P->>P: 执行本节演示和工具调用', 'P-->>U: 输出验收结果并退出']
    if number in ('000', '069'):
        args = ['读取 README'] if number == '000' else ['/tool read {"path":"package.json"}']
        add(bun_launch('Bun：CLI 入口', 'src/main.mjs', args=args,
                       **({'runtimeArgs': ['--no-env-file', '--preload', '${workspaceFolder}/scripts/vscode-debug.mjs'],
                           'env': {'HARNESS_HOME': '${workspaceFolder}/.data-debug-069', 'DEEPSEEK_API_KEY': '', 'HARNESS_SESSION': ''}}
                          if number == '069' else {})),
            '本节直接入口', 'src/main.mjs', '直接命中 CLI；固定测试中的 spawnSync 不自动附加子 CLI。')
        primary = 'Bun：CLI 入口'
        reason = ('000 只检查命令行输入；它尚不会读文件或调用模型。' if number == '000' else
                  '069 的 CLI 才组装持久 Host；用独立数据目录、空密钥和本地 package.json 观察真实读文件。')
    if number == '032':
        add(attach('Bun：032跨进程RPC主进程', 'ws://127.0.0.1:6499/rpc-032'), '父侧业务', 'src/rpc-demo.mjs', '等待父侧审批与 RPC；不选择测试包装器来调 demo。')
        add(attach('Bun：032 RPC worker子进程', 'ws://127.0.0.1:6500/rpc-worker-032'), '子侧工具', 'src/rpc-worker.mjs', '父已继续并创建 worker 后再附加。')
        commands = ['bun --preload ./scripts/vscode-debug.mjs --inspect-brk=127.0.0.1:6499/rpc-032 src/rpc-demo.mjs --debug-worker']
        requirements = ['删除工具的演示只使用本次临时目录；需要在终端回答两次审批。可用 --auto 做自动验收，不能把自动回答当作用户授权。']
    if number in ('033', '035'):
        protocol, port, route = ('MCP', '6501', 'mcp-033') if number == '033' else ('LSP', '6502', 'lsp-035')
        parent_route = 'mcp-parent-033' if number == '033' else 'lsp-parent-035'
        parent_name = 'Bun：033 MCP父测试进程' if number == '033' else 'Bun：035 LSP父测试'
        child_name = 'Bun：033 MCP子进程' if number == '033' else 'Bun：035 LSP子进程'
        add(attach(parent_name, 'ws://127.0.0.1:6499/' + parent_route), '父侧协议', lesson['test'], '使用文末调试扩展后，终端先启动，再连接父测试。')
        add(attach(child_name, f'ws://127.0.0.1:{port}/{route}'), '子侧服务', f'tests/fixtures/{protocol.lower()}.mjs', '父测试继续后才创建服务，随后附加子调试器。')
        commands = [f'{protocol}_DEBUG=1 bun test --timeout 0 --preload ./scripts/vscode-debug.mjs --inspect-brk=127.0.0.1:6499/{parent_route} ./{lesson["test"]}']
        requirements = [f'双进程断点需要先按文末完整安装 {number} 的调试扩展文件；本节基础增量没有自动开启子 Inspector 的开关，单独复制 launch.json 不足以启用。']
    if number in ('032', '033', '035'):
        reason = '先启动并连接父进程，再继续父进程让它创建子服务，最后附加子进程。两个 Inspector、两份调用栈；父侧 F11 不会跨管道进入子侧。'
        actions = ['U->>P: 终端执行本节双进程命令', 'P-->>U: 父 Inspector 等待',
                   'U->>D: 附加本节父配置', 'D->>P: F5 继续父进程', 'P->>C: spawn 子服务并开启独立 Inspector',
                   'C-->>U: 子 Inspector 等待', 'U->>D: 附加本节子配置', 'D->>C: 继续子进程',
                   'P->>C: 原业务管道传递请求', 'C-->>P: 响应或反向审批', 'P-->>U: 关闭管道并回收进程']
    if number in ('044', '046'):
        add(attach('Bun：附加子进程', '${input:bunInspectorUrl}'), '按需附加 Host', '本次输出的 ws:// 地址', '只连接本节子进程；先启动父侧，不使用前章固定端口。')
        inputs.append(dict(id='bunInspectorUrl', type='promptString', description='粘贴本节子进程输出的完整 ws:// 地址'))
        if number == '044':
            add(bun_launch('044：SDK测试（等待附加Host）', lesson['test'], test=True, env={'SDK_DEBUG_HOST': '1'}),
                '需要 Host 内部断点时', lesson['test'], '显式开启等待；只启动此配置不会完成测试，还要附加 Host。')
            requirements = ['本节演示和普通测试不开子 Inspector；SDK_DEBUG_HOST=1 才延长 SDK 请求预算并等待附加。']
        else:
            requirements = ['普通 ACP 测试只调父侧；如需服务端断点，先按文末临时加入子 Inspector 并显示 stderr。ACP 请求与取消有真实计时，观察后继续运行并恢复改动。']
        actions = ['U->>D: 选本节普通测试或等待附加模式', 'D->>P: 启动本节父测试', 'P->>C: spawn 独立 Bun Host',
                   'alt 已显式开启子 Inspector 等待', 'C-->>U: 打印本次 ws:// 地址并等待',
                   'U->>D: 另选附加子进程，粘贴地址', 'D->>C: 连接并继续', 'else 普通运行', 'C->>C: 直接执行服务入口', 'end',
                   'P->>C: stdio 请求', 'C-->>P: 结果、通知或审批', 'P->>C: EOF 与清理', 'C-->>P: 子进程退出']
    if number == '045':
        python = dict(name='Python：SDK 客户端', type='debugpy', request='launch',
                      program='${workspaceFolder}/tests/fixtures/python-sdk.py', cwd='${workspaceFolder}',
                      python='/usr/bin/python3', console='integratedTerminal', justMyCode=True,
                      env={'PYTHONPATH': '${workspaceFolder}/python'},
                      args=['bun', '${workspaceFolder}/src/sdk-server.mjs', '${workspaceFolder}/.data-python-debug'])
        add(python, '本节 Python 实现', 'tests/fixtures/python-sdk.py', 'Python 主线程与读取线程；它的 Bun 子 Host 是另一目标。')
        primary = python['name']
        reason = 'Bun 测试只用 spawnSync 启动 Python 并等结果；要进入 Python 的 request/_read，必须直接用 debugpy 启动 fixture，不能从 Bun 按 F11 跨过去。'
        requirements = ['安装 ms-python.debugpy，先执行 mkdir -p .data-python-debug；python 字段使用本机 Python 路径，Bun 路径也必须可解析。普通测试使用临时目录；调试目录保留会话。']
        actions = ['U->>D: 选择 Python：SDK 客户端', 'D->>P: debugpy 启动 Python fixture',
                   'P->>P: 启动读取线程并登记请求 Queue', 'P->>C: Python Popen 启动 Bun sdk-server',
                   'P->>C: stdin 写 JSON 请求', 'C-->>P: stdout 返回响应与通知',
                   'D->>P: 在 Python request 和 _read 观察断点', 'P->>C: EOF，等待 Host 退出']
    if number in ('049', '050', '051', '068'):
        add(bun_launch('Web：Bun Host', 'src/web-server.mjs', env={'HARNESS_HOME': '${workspaceFolder}/.data-web', 'HARNESS_PORT': '0'}),
            '本节手工 Web 操作', 'src/web-server.mjs', 'Host、Remote 与 Agent 的 Bun 调试会话。')
        add(dict(name='Web：页面', type='chrome', request='launch', url='${input:webBootstrapUrl}',
                 webRoot='${workspaceFolder}/web', pathMapping={'/view.mjs': '${workspaceFolder}/src/view.mjs'}),
            '本节手工 Web 操作', 'web/app.mjs', '浏览器 JS 会话，必须使用本次 Host 的 URL。')
        inputs.append(dict(id='webBootstrapUrl', type='promptString', description='粘贴本次 Host 输出的完整 http://127.0.0.1:端口/?token=... 地址'))
        if number == '049':
            primary = 'Web：Bun Host'
        reason = '页面代码与 Host 代码在两个运行时。先启动 Host 获得动态端口和 token，再启动页面；从页面 F11 不能直接跳到服务端。固定测试只证明该测试实际覆盖的行为。'
        actions = ['U->>D: 选择 Web：Bun Host', 'D->>P: 启动本节 web-server',
                   'P-->>U: 打印本次含 token 的启动 URL', 'U->>D: 选择 Web：页面，粘贴完整 URL',
                   'D->>C: 启动受调试的 Chrome 页面', 'C->>P: HTTP 认证与 WebSocket 业务请求',
                   'P-->>C: 结果与会话事件', 'U->>D: 在调用堆栈切换页面和 Host']
        if number == '068':
            requirements.append('自动 E2E 需要可用的本机 Chrome；它另开浏览器，与手工 Web：页面会话分开，不能声称已附加自动测试的浏览器。')
    if number == '052':
        add(dict(name='Electron：Main', type='node', request='attach', address='127.0.0.1', port=9229, skipFiles=['<node_internals>/**']),
            '桌面主进程', 'desktop/main.cjs', 'Electron 内置运行时；不是领域 Host。')
        add(attach('Electron：Bun Host', 'ws://127.0.0.1:6499/harness-host'),
            '桌面领域进程', 'src/web-server.mjs', '主进程继续并创建 Host 后才能附加。')
        add(dict(name='Electron：Renderer', type='chrome', request='attach', address='127.0.0.1', port=9222,
                 webRoot='${workspaceFolder}/web', pathMapping={'/view.mjs': '${workspaceFolder}/src/view.mjs'}),
            '桌面页面', 'web/app.mjs 与 desktop/preload.cjs', '窗口加载后附加；preload 并非独立 Bun 进程。')
        commands = ['HARNESS_VSCODE_DEBUG=1 env -u DEEPSEEK_API_KEY bun run desktop']
        requirements = ['需要本机可启动的 Electron。策略单测通过不等于 GUI 已启动；本次修改不下载 Electron、不构建安装包。']
        reason = 'Main、Bun Host、Renderer 是三个执行目标，分别使用 Node Inspector、Bun Inspector 和浏览器协议；先连接 Main 并继续，后两个目标才会出现。'
        actions = ['U->>P: 终端通过 Bun 启动 Electron', 'P-->>U: Main 在 9229 等待',
                   'U->>D: 附加 Electron：Main 并继续', 'P->>C: 创建 Bun Host，开放 6499',
                   'C-->>P: 返回页面 URL', 'P->>P: 创建 Renderer 窗口，开放 9222',
                   'U->>D: 分别附加 Bun Host 与 Renderer', 'D->>C: 调试 Host；切换会话看 Main 或页面',
                   'U->>P: 退出应用，回收 Host']
    if number in EXTERNAL_TESTS:
        target, note = EXTERNAL_TESTS[number]
        reason += ' ' + note
        if not actions:
            actions = [f'U->>D: 选择 {test_name}', f'D->>P: 启动 {lesson["test"]}',
                       f'P->>C: 启动或调用 {target}', 'Note over D,C: 当前调试器只连接父侧，F11 不跨进程',
                       'C-->>P: 返回结果、输出或退出状态', 'P-->>U: 本节断言与资源清理']
    sequence = startup_sequence(actions) if actions else None
    if number == '052':
        # 桌面必须画出三个真实执行目标，不能把 Renderer 画成 Main 的同一调用栈。
        sequence = '\n'.join([
            'sequenceDiagram', '    actor U as 学习者与终端', '    participant D as VS Code 调试器',
            '    participant M as Electron Main', '    participant H as Bun Host', '    participant R as Renderer 与 preload',
            '    U->>M: 通过 Bun 启动器创建 Electron，开启 9229 和 9222',
            '    U->>D: 附加 Electron：Main', '    D->>M: 连接 9229 并继续',
            '    M->>H: startHost，spawn Bun 并开放 6499', '    H-->>M: 返回本次页面 URL',
            '    M->>R: 创建窗口并加载 URL 与 preload',
            '    U->>D: 再附加 Electron：Bun Host 与 Renderer',
            '    D->>H: 连接 Bun Inspector', '    D->>R: 连接页面调试目标',
            '    R->>H: Web 业务请求', '    H-->>R: 结果与事件',
            '    U->>M: 关闭应用', '    M->>H: 等待 Host 清理退出',
        ])
    return dict(id=number, primary=primary, launch=dict(version='0.2.0', configurations=configurations,
                **({'inputs': inputs} if inputs else {})), rows=rows, reason=reason,
                requirements=requirements, commands=commands,
                sequence=sequence)


def write_launch_files(lessons):
    """只生成教程增量的配置，不覆盖学习者 harness-own 的个人断点或配置。"""
    for lesson in lessons:
        destination = ROOT / 'steps' / lesson['id'] / '.vscode/launch.json'
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(json.dumps(plan_for(lesson)['launch'], ensure_ascii=False, indent=2) + '\n')


def render_debugging(lesson):
    """渲染本节专属配置清单、为什么、启动步骤与必要的复杂启动图。"""
    plan = plan_for(lesson)
    lines = ['## 本节调试：选什么、为什么、怎么启动', '',
             f'**建议先选：{plan["primary"]}。** 每节的测试入口都固定到本节文件，不依赖编辑器当前打开的 `${{file}}`。', '',
             '| 配置名称 | 什么时候选 | 实际入口或目标 | 能观察什么 |', '| --- | --- | --- | --- |']
    lines += ['| ' + ' | '.join(row) + ' |' for row in plan['rows']]
    lines += ['', '**为什么这样启动：** ' + plan['reason'], '',
              '使用下方的[本节专用调试配置](#lesson-debug-config)。它只列本节可用目标；要保留个人配置，请先备份并按名称合并。页面上 `harness-own` 的累计文件链接供看当前工程，不是本节调试配置的答案。', '',
              '1. VS Code 打开自己的 PROJECT；按本节创建源码与配置，断点设在 PROJECT 文件中。',
              f'2. 先用终端运行 `bun test ./{lesson["test"]}` 确认普通验收，再选表中的配置按 F5。',
              '3. 在下方具体观察点停住；F10 跨过当前语句，F11 只进入当前调试目标。异步等待涉及另一进程时，切换调试会话并继续对端。',
              '4. 变量要在所属调用帧查看；看测试局部变量时选测试帧，看 this 和参数时选实现方法帧。', '',
              '**本节具体断点和预期：** ' + lesson['debug'], '']
    if lesson['id'] == '000':
        lines += ['先安装 Bun 扩展 `oven.bun-vscode`。若找不到 Bun，在 PROJECT 终端执行 `which bun`，将 runtime 换成实际绝对路径。', '']
    if plan['requirements']:
        lines += ['### 本节启动前置', ''] + ['- ' + item for item in plan['requirements']] + ['']
    if plan['commands']:
        lines += ['### 本节终端启动命令', '', '先在 PROJECT 执行。Attach 配置不会替你启动进程；不同章节使用相同端口时不能同时启动。', '',
                  '```sh', 'cd "$PROJECT"', *plan['commands'], '```', '']
    if plan['sequence']:
        lines += ['### 本节调试启动时序', '', '这张图解释如何创建并连接调试目标；上面的业务时序图解释任务本身怎样执行。', '',
                  '```mermaid', plan['sequence'], '```', '']
    lines += ['暂停断点会影响应用自身的 RPC、取消、进程和网络计时。Bun 测试超时放宽不等于这些计时也被关闭；按本节说明分别设置，普通验收恢复原有时限。', '',
              f'观察完成后退出本节启动的调试会话和进程，再运行 `bun test ./{lesson["test"]}`。测试通过只证明本节断言，不代表所有 GUI、外部服务或发布过程均已验证。']
    return '\n'.join(lines)
