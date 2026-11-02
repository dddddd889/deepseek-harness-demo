"""按当前课真实配置组织调试路线；入口数、路线数和进程数分别说明。"""

import json


def route(purpose, configs, steps, targets, finish, note=''):
    """一条路线可以使用多个调试配置，也可以先由终端创建进程。"""
    return dict(purpose=purpose, configs=configs, steps=steps, targets=targets, finish=finish, note=note)


def routes_for(lesson, plan):
    """只引用plan里已经存在的配置，不为当前课虚构跨进程调试能力。"""
    number = lesson['id']
    configs = plan['launch']['configurations']
    test_name = number + '：本节测试'
    external = {
        '000': '测试另起CLI，只观察父测试断言；CLI内部选择下方直接入口路线。',
        '018': 'CLI验收另起演示进程；真实演示请走附加路线。',
        '020': '完整demo是另一个进程；普通测试只观察父侧适配与输出。',
        '022': '测试的文件编辑在父侧；另起CLI不会自动跟随调试器。',
        '025': '测试自己启动命令子进程，Bun断点只看父侧进程管理与输出收集。',
        '026': '测试自己启动Bash，父侧F11不能进入Shell；固定5秒预算不因测试超时放宽而改变。',
        '027': '测试自己启动PTY/Vim，不另开Vim调试会话；就绪检查只有数秒。',
        '032': '父测试用spawnSync等待demo，业务父子断点请选择下方双进程路线。',
        '033': '普通测试自动创建MCP子服务，但只调父侧；子断点需要下方扩展路线。',
        '035': '普通测试自动创建LSP子服务，但只调父侧；子断点需要下方扩展路线。',
        '044': '测试会创建Bun Host，但普通配置不等待子调试器。',
        '045': 'Bun测试启动Python，Python再启动Bun Host；这里只调外层Bun测试。',
        '046': '测试会创建ACP Host；默认只调父SDK，不进入服务端。',
        '052': '策略测试不创建Electron窗口，不会命中Main、Host或Renderer启动断点。',
        '058': '测试自己启动Hook命令；本配置只调父侧Hook管理，不进入外部脚本。',
        '059': '测试自己启动隔离Chrome。Bun调试器只进入Playwright客户端，不进入页面JS；系统动作使用执行替身。',
        '061': '测试自己创建HTTP服务和Host，再发送请求；不要手动启动监听服务或发送脚本。',
        '063': '测试创建Worker Host子进程，本配置SDK_DEBUG_HOST=0，只调父侧Workers和SDK；没有自动子进程附加路线。',
        '066': 'tsc是自动启动的编译检查子进程，只看status；查询业务仍在父侧。',
        '068': '测试自动启动自己的Chrome，Host和Playwright客户端在父测试；不是下方手工页面会话。',
        '069': '测试另起CLI，只检查输出和退出状态；内部断点请选择直接CLI路线。',
    }
    result = [route('自动测试', [test_name], [
        f'先打开`{lesson["test"]}`及下方“具体断点和预期”列出的实现文件，设置本章断点。',
        f'选择“{test_name}”按F5，配置固定到本章测试；不需要先运行前章服务或CLI。',
        external.get(number, '测试直接驱动本章实现；在同一Bun调试会话内按F10/F11观察，不必另建服务会话。'),
        '按下方本章观察点检查变量和断言；断点停顿可能触发实现自己的计时，必要时先继续完成当前调用。',
    ], f'`{lesson["test"]}`与下方列出的本章实现断点',
        '断言结束后测试退出；测试清理自己创建的资源。异常中止后检查本章临时进程，不把尚在等待当作测试通过。')]

    # 两端Attach必须归为一条路线，不能把“附加子进程”误写成能独立启动的入口。
    if number in ('032', '033', '035'):
        parents = [config['name'] for config in configs if config['request'] == 'attach']
        preflight = ('先完成本页基础文件。' if number == '032' else
                     '先完成基础测试，再按文末调试实操完整替换扩展文件；只复制launch.json不能启用子Inspector。')
        result.append(route('父子两端联合调试', parents, [
            preflight,
            '在PROJECT终端执行下方“本节终端启动命令”，父进程会在inspect-brk处等待。',
            f'先选择“{parents[0]}”附加，设置父侧断点并继续；父进程此时才会spawn子进程。',
            f'看到子Inspector就绪后，保留父会话，再选择“{parents[1]}”建立第二个会话并继续。',
            '先让请求方发送请求，再切到接收方观察处理；一侧停在await时，检查另一侧是否仍暂停。',
        ], {'032': '父：src/rpc-demo.mjs审批handler；子：src/rpc-worker.mjs的peer.handle和unlink',
            '033': '父：src/mcp.mjs的client.connect和callTool；子：tests/fixtures/mcp.mjs分页和工具处理',
            '035': '父：src/lsp.mjs的request、versions.set和query；子：tests/fixtures/lsp.mjs的definition与shutdown'}[number],
            '观察完先继续两侧，让业务执行shutdown/EOF并回收子进程；终端确认退出，再关闭附加会话。',
            '父子是两个Bun进程、两份调用栈。033/035扩展同时处理协议请求超时，普通回归恢复默认开关。'))

    if number == '044':
        result.append(route('SDK客户端与Host两端调试', ['044：SDK测试（等待附加Host）', 'Bun：附加子进程'], [
            '先设置src/sdk.mjs的spawn/create/run，以及src/sdk-server.mjs或Host实现中的断点。',
            '选择“044：SDK测试（等待附加Host）”按F5；配置设置SDK_DEBUG_HOST=1，父测试会创建等待附加的Host。',
            '复制Host本次打印的完整ws://地址，保留父会话，启动“Bun：附加子进程”并粘贴地址。',
            '继续Host，再按协议调用顺序切换父SDK与子Host；父侧F11不能跨stdio。',
        ], '父：src/sdk.mjs；子：src/sdk-server.mjs及src/host.mjs、src/agent.mjs',
            '继续两侧直到SDK关闭管道、Host退出、测试结束；不要只停止Host而让父请求继续等待。',
            '这是两个Bun进程。普通SDK运行演示不开子Inspector，不能单独启动Attach配置期待出现Host。'))

    if number == '045':
        result.append(route('直接调Python客户端', ['Python：SDK 客户端'], [
            '安装debugpy扩展，创建.data-python-debug；按本机情况核对Python路径与参数中的Bun路径。',
            '在python/harness_sdk.py的request、_read和run设断点，选择“Python：SDK 客户端”按F5。',
            'debugpy启动fixture，fixture通过Popen创建Bun Host；不先启动外层Bun测试。',
            '在Python主线程发送处和读取线程waiting.put处切换调用帧；协议响应由子Host返回。',
        ], 'tests/fixtures/python-sdk.py与python/harness_sdk.py',
            '继续Python到SDK关闭、EOF与子进程回收；结束debugpy会话，调试数据目录保留。',
            '此路线有Python客户端与Bun Host两个执行进程，仅Python被debugpy附加；当前配置不调子Host内部。'))

    if number == '046':
        result.append(route('ACP父客户端与子Host联合调试', [test_name, 'Bun：附加子进程'], [
            '先按文末ACP子进程调试说明临时修改测试的spawn参数为inspect-wait，并把stderr显示出来；协议stdout保持专用。',
            f'选择“{test_name}”按F5，父侧创建等待中的ACP Host；不是仅打开ACP_TRACE日志。',
            '复制子进程打印的完整ws://地址，保留父会话，启动“Bun：附加子进程”并粘贴地址。',
            '继续子Host，切换两侧观察请求与响应；取消场景有真实计时，长时间暂停会影响断言。',
        ], '父：tests/046-acp.test.mjs与ACP SDK调用；子：src/acp-server.mjs、src/acp.mjs',
            '继续到协议关闭、子Host退出和测试结束；恢复临时spawn/stderr改动，再做普通回归。',
            '条件路线：文末扩展装好后才可用。两个Bun进程，父侧F11不跨stdio。'))

    if number in ('049', '050', '051', '068'):
        result.append(route('手工调Web页面与Host', ['Web：Bun Host', 'Web：页面'], [
            '先在src/web-server.mjs、src/remote.mjs及web/app.mjs设断点，选择“Web：Bun Host”按F5。',
            '继续Host到终端打印含token的完整启动URL；停在启动代码前时不要先开页面。',
            '保留Host会话，选择“Web：页面”按F5并粘贴本次URL，浏览器由该配置启动。',
            '在页面执行本章动作；页面停在rpc时继续发送，再切Host观察Remote/Agent。',
            '要观察页面初始化，先确认页面调试会话已连接、断点已设置，再刷新；要调事件处理，需点击对应按钮或提交任务。',
        ], '页面：web/app.mjs的rpc、socket.onmessage、render；服务：src/remote.mjs和本章领域实现',
            '先关闭调试页面，再正常退出Host；确认临时服务端口不再被占用。',
            '页面JS与Host是两个调试目标。068自动E2E另开Chrome，不能把手工页面会话当作已附加自动测试浏览器。'))

    if number == '052':
        result.append(route('Electron的Main、Host与Renderer联合调试', ['Electron：Main', 'Electron：Bun Host', 'Electron：Renderer'], [
            '先设置desktop/main.cjs的spawn/new BrowserWindow、src/remote.mjs和web/app.mjs断点，再在PROJECT终端执行下方桌面调试命令。',
            'Electron Main在9229等待，先选择“Electron：Main”附加并继续；不要把spawn所在行暂停误认为Host已启动。',
            'Main执行spawn后才创建Bun Host。看到6499已监听，再选择“Electron：Bun Host”附加；默认inspect不会等待，早期启动语句可能已经执行。',
            '要命中Host启动早期代码，按本页桌面调试补充临时用inspect-brk替换Host的inspect参数，先附加并继续Host，再等它返回URL。',
            'Main拿到URL并创建窗口后，再附加“Electron：Renderer”(9222)。页面初始化断点需附加后刷新；事件断点需执行对应页面动作。',
            '保留三个会话，按Main启动、页面RPC、Host业务分别切换；F11只在当前运行时内前进。',
        ], 'Main：desktop/main.cjs；Host：src/web-server.mjs和src/remote.mjs；Renderer：web/app.mjs和desktop/preload.cjs',
            '继续暂停的会话，再正常退出Electron，等待Main回收Host；确认9229、6499、9222关闭后再启动下一次。',
            'Main、Bun Host、Renderer是三个调试目标；Electron还可能有GPU等辅助进程，不把它们当作教程中的额外入口。'))

    if number == '061':
        for purpose, selected, sending in [
            ('接收端调试，终端发送', ['061：Webhook监听服务'], '另开PROJECT终端，按文末命令运行发送脚本并填入URL；不再启动第二份服务。'),
            ('收发两端联合调试', ['061：Webhook监听服务', '061：Webhook发送请求'], '保留监听会话，启动“061：Webhook发送请求”，输入URL、任务与delivery；建立第二个调试会话。'),
        ]:
            result.append(route(purpose, selected, [
                '先选择“061：Webhook监听服务”按F5，在server.listen断点后继续，直到打印本次Webhook地址。',
                sending,
                '发送端发出POST后，切接收端观察receive、验签、Journal追加和pump；服务暂停时发送端等待响应是正常的。',
                '继续Agent到model.stream、message/assistant与turn/end，检查离线回复和completed；202只代表接收。',
            ], '发送：scripts/send-webhook.mjs；接收：src/webhook-http.mjs、src/webhook.mjs、src/agent.mjs',
                '发送脚本打印回执后退出；服务保持监听，观察完成后继续服务并按Ctrl+C，释放端口、Host和Journal。',
                'HTTP/Host/Agent/OfflineModel共用服务进程，发送脚本是另一个Bun进程；调试等待与签名时间窗见文末。'))

    # 单独可启动的普通演示与CLI各是一条路线，不与测试同时运行。
    covered = {name for item in result for name in item['configs']}
    for config in configs:
        name = config['name']
        if name in covered:
            continue
        if config['request'] == 'attach':
            # 剩余Attach是018/020/022的完整演示路线，由终端先创建进程。
            result.append(route('终端启动演示后附加', [name], [
                '先完成本节全部源码，在PROJECT执行下方“本节终端启动命令”。',
                '等待Inspector地址打印；inspect-brk会暂停入口，此时选择“' + name + '”附加。',
                '设置本页演示断点，继续入口；观察本节完整场景，不再另起普通测试包装器。',
            ], config.get('url', '') + '，断点按本页演示说明',
                '继续演示直到终端退出，再结束附加会话；不要让旧进程占着同一个Inspector端口。'))
        else:
            program = config.get('program', '').replace('${workspaceFolder}/', '')
            result.append(route('直接运行CLI' if name == 'Bun：CLI 入口' else '直接运行本章演示', [name], [
                '先完成本章代码，在`' + program + '`及其本章实现中设置断点。',
                '选择“' + name + '”按F5；这是launch，VS Code创建进程，不需要先用终端启动同一个入口。',
                '按本页说明核对args、工作目录和前置文件，再继续；观察目标在当前会话，不同时启动测试包装器。',
            ], '`' + program + '`及下方本章断点',
                '演示/CLI执行结束自动退出；若有审批或长任务先按本页说明处理，提前退出用正常取消并确认子资源已回收。',
                {'000': '本章CLI只处理输入，不会读文件或调用模型。',
                 '044': 'SDK演示自动创建Host，但不开子Inspector；子Host断点选择上方等待附加路线。',
                 '069': '本配置使用独立数据目录与离线工具任务，不需要真实模型Key。'}.get(number, '这条路线与自动测试是不同启动方式，二选一观察，不把两份运行数据混在一起。')))
    return result


def render_routes(lesson, plan):
    """先给路线总览，再用折叠步骤解释每条路线的先后、断点与退出。"""
    routes = routes_for(lesson, plan)
    count = len(plan['launch']['configurations'])
    lines = ['### 调试路线：先启动谁，再启动谁', '',
             f'本节有 **{count} 个调试配置、{len(routes)} 条调试路线**。配置是启动或附加按钮；一条路线可能连续使用多个配置。请选择一条路线，不必把所有入口都启动。', '',
             '| 路线 | 用哪些配置，按顺序 | 谁创建进程 | 结果在哪里看 |', '| --- | --- | --- | --- |']
    configs = {item['name']: item for item in plan['launch']['configurations']}
    for index, item in enumerate(routes):
        label = chr(65 + index)
        names = ' → '.join('“' + name + '”' for name in item['configs'])
        if configs[item['configs'][0]]['request'] == 'attach':
            creator = '终端先启动；Attach只连接'
        elif any(configs[name]['request'] == 'attach' for name in item['configs']):
            creator = '先F5创建入口；子目标就绪后再附加'
        else:
            creator = 'F5的launch配置创建；子目标按下方步骤自动创建'
        lines.append(f'| {label} {item["purpose"]} | {names} | {creator} | {item["targets"]} |')
    lines += ['', '先完成本节源码并安装[本节专用调试配置](#lesson-debug-config)。下面的路线只对应本节，不沿用前章端口或旧会话。', '']
    if len(routes) > 1:
        # 路线图强调启动与附加顺序；复杂进程通信仍由本节启动时序图说明。
        graph = ['flowchart TD', '    Pick["选择本节调试目的"]']
        for index, item in enumerate(routes):
            label = chr(65 + index)
            title = json.dumps('路线 ' + label + '：' + item['purpose'], ensure_ascii=False)
            graph.append(f'    Pick --> R{index}[{title}]')
            previous = f'R{index}'
            if configs[item['configs'][0]]['request'] == 'attach':
                graph.append(f'    {previous} --> T{index}["先在终端执行本节启动命令"]')
                previous = f'T{index}'
            for step, name in enumerate(item['configs']):
                action = '附加：' if configs[name]['request'] == 'attach' else 'F5启动：'
                text = json.dumps(action + name, ensure_ascii=False)
                node = f'C{index}S{step}'
                graph.append(f'    {previous} --> {node}[{text}]')
                previous = node
            if lesson['id'] == '061' and item['purpose'] == '接收端调试，终端发送':
                graph.append(f'    {previous} --> Send{index}["打印URL后，再在终端运行发送脚本"]')
        lines += ['```mermaid', '\n'.join(graph), '```', '']

    if len(routes) == 1:
        lines += ['本章目前只有这一条已配置路线；源码中未接入测试或没有独立调试入口的能力，不因为后面存在同名模块就自动可调。', '']
    for index, item in enumerate(routes):
        label = chr(65 + index)
        lines += ['<details class="debug-route">', f'<summary>路线 {label}：{item["purpose"]}——启动、断点和退出</summary>', '']
        lines += [f'{step}. {text}' for step, text in enumerate(item['steps'], start=1)]
        lines += ['', '**断点与观察位置：** ' + item['targets'], '', '**结束方式：** ' + item['finish'], '']
        if item['note']:
            lines += ['**进程边界与前置条件：** ' + item['note'], '']
        lines += ['</details>', '']
    return '\n'.join(lines)
