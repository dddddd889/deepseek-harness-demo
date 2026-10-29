"""从同一份节点与连线定义生成 Web / ACP 领域对照 SVG 和 Mermaid 图源。"""

from html import escape
from pathlib import Path

# 专题图独立放置，避免混入固定数量的逐课图解。
destination = Path(__file__).resolve().parent / 'web-acp'
destination.mkdir(exist_ok=True)
width, height = 1320, 1360
palette = {
    'web': ('#edf2ff', '#3157d5'),
    'acp': ('#fff5e5', '#9a5a15'),
    'shared': ('#eaf5ef', '#28734d'),
    'neutral': ('#f4f6fa', '#667085'),
}
# 区域边框表示参与者或宿主归属；并列入口不代表默认同时装配。
regions = [
    ('users', 30, 85, 1260, 80, '用户侧：Web 用户，或 IDE / 父 Agent 的使用者', 'neutral'),
    ('webClient', 30, 205, 610, 230, '原生 Web 客户端进程', 'web'),
    ('acpClient', 680, 205, 610, 230, 'ACP 客户端进程', 'acp'),
    ('host', 30, 565, 1260, 560, 'Agent Server 端：宿主职责合画，两个入口可分别装配 / 部署', 'neutral'),
    ('models', 30, 1200, 1260, 105, '远端模型服务（独立于 ACP / Web 协议）', 'neutral'),
]
# 每个节点的行文本同时进入 SVG 与 Mermaid，保证两种图源语义一致。
nodes = [
    ('webUi', 'webClient', 55, 260, 560, 65, 'web', ['Web UI：输入、展示、审批、停止']),
    ('webRuntime', 'webClient', 55, 350, 560, 65, 'web', ['SessionRuntime / ctx.remote / Connection', '原生客户端状态镜像与 API 调用']),
    ('acpUi', 'acpClient', 705, 260, 560, 65, 'acp', ['IDE UI / 父 Agent / 自动化程序']),
    ('acpSdk', 'acpClient', 705, 350, 560, 65, 'acp', ['ACP Client SDK：ClientSideConnection', '处理输出通知与权限请求']),
    ('webEntry', 'host', 55, 625, 560, 190, 'web', ['Web 接入：Connection + API Proxy / Gateway', 'prompt：session.prompt → accepted', '输出：events.mux / events.host WebSocket', '取消：session.cancel；审批：POST /api/respond']),
    ('acpEntry', 'host', 705, 625, 560, 190, 'acp', ['ACP 接入：AgentSideConnection + dsh-acp', 'prompt：session/prompt → 最终 stopReason', '输出：session/update（已提交文本 / 图片）', '取消：session/cancel；审批：request_permission']),
    ('shared', 'host', 110, 915, 1100, 160, 'shared', ['共用业务实现与接口：Agent 管理 / Agent 句柄 / Inbox / Agent Loop', '共用事实与扩展点：Session / SessionEvent / approval/request', '共用执行能力：工具管线 / LLM 接口 / 模型适配器']),
]
# 连线说明标记跨进程传输或本地协作，不把内部方法当成第三套网络协议。
edges = [
    ('users', 'webClient', '用户操作', [(335, 165), (335, 205)], False, None),
    ('users', 'acpClient', '用户操作 / 程序调用', [(985, 165), (985, 205)], False, None),
    ('webUi', 'webRuntime', '本地调用', [(335, 325), (335, 350)], True, None),
    ('acpUi', 'acpSdk', '本地调用', [(985, 325), (985, 350)], True, None),
    ('webRuntime', 'webEntry', '跨进程：HTTP POST 上行；双 WebSocket 下行', [(335, 415), (335, 625)], True, (335, 488)),
    ('acpSdk', 'acpEntry', '跨进程：stdio 双向 JSON-RPC / NDJSON', [(985, 415), (985, 625)], True, (985, 488)),
    ('webEntry', 'shared', '本地调用 / 事件；Web 接入策略', [(335, 815), (335, 915)], True, (335, 863)),
    ('acpEntry', 'shared', '本地调用 / 事件；ACP 接入策略', [(985, 815), (985, 915)], True, (985, 863)),
    ('shared', 'models', '跨网络：模型适配器 → HTTPS / SSE 等模型协议', [(1100, 1075), (1100, 1140), (660, 1140), (660, 1200)], True, (660, 1165)),
]


def text(x, y, rows, size=18, color='#172033'):
    """生成居中分行文本；坐标与行距由图形布局提供。"""
    spans = ''.join('<tspan x="{}" dy="{}">{}</tspan>'.format(x, 0 if i == 0 else 28, escape(row)) for i, row in enumerate(rows))
    return '<text x="{}" y="{}" text-anchor="middle" fill="{}" font-size="{}">{}</text>'.format(x, y, color, size, spans)


def render_svg():
    """绘制离线可读总图，区域表示归属，颜色表示各自实现或共用实现。"""
    parts = [
        '<svg xmlns="http://www.w3.org/2000/svg" width="1320" height="1360" viewBox="0 0 1320 1360" role="img" aria-labelledby="title desc">',
        '<title id="title">Web API 与 ACP：领域、独立接入和共用运行时</title>',
        '<desc id="desc">用户侧分别连接 Web 客户端和 ACP 客户端。两种协议进入 Agent Server 各自的接入层，通过同进程方法和事件复用 Agent、Inbox、Loop、Session、审批与模型能力。两入口可分开部署，共用实现不代表共用同一个会话。</desc>',
        '<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="#667085"/></marker></defs>',
        '<rect width="1320" height="1360" fill="#fbfcfe"/>',
        '<g font-family="PingFang SC,Microsoft YaHei,sans-serif">',
        text(660, 36, ['Web API 与 ACP：不同入口，共用服务端业务能力'], 24),
        text(660, 64, ['蓝色：Web 自有实现　橙色：ACP 自有实现　绿色：共用实现与服务约定'], 17),
    ]
    for _, x, y, w, h, label, kind in regions:
        fill, stroke = palette[kind]
        parts.append('<rect x="{}" y="{}" width="{}" height="{}" rx="12" fill="{}" stroke="{}"/>'.format(x, y, w, h, fill, stroke))
        parts.append(text(x + w / 2, y + (46 if h == 80 else 32), [label], 19))
    for _, _, x, y, w, h, kind, rows in nodes:
        _, stroke = palette[kind]
        parts.append('<rect x="{}" y="{}" width="{}" height="{}" rx="10" fill="white" stroke="{}" stroke-width="2"/>'.format(x, y, w, h, stroke))
        parts.append(text(x + w / 2, y + h / 2 - (len(rows) - 1) * 14 + 6, rows, 18))
    for _, _, label, points, both, label_at in edges:
        coordinates = ' '.join('{},{}'.format(x, y) for x, y in points)
        parts.append('<polyline points="{}" fill="none" stroke="#667085" stroke-width="2" marker-end="url(#arrow)" {}/>'.format(coordinates, 'marker-start="url(#arrow)"' if both else ''))
        if label_at:
            x, y = label_at
            box_width = 595 if y == 488 else 540
            parts.append('<rect x="{}" y="{}" width="{}" height="34" rx="5" fill="#fbfcfe"/>'.format(x - box_width / 2, y - 23, box_width))
            parts.append(text(x, y, [label], 17))
    parts.append(text(660, 1105, ['共用代码与接口 ≠ 自动共享会话、Agent 实例或连接所有权'], 17))
    parts.append(text(660, 1272, ['DeepSeek 等模型 API；Agent Loop 经适配器发起请求、接收分片'], 19))
    parts.append(text(660, 1338, ['当前实现：Web 可展示模型增量；dsh-acp 仅发送已提交消息；客户端没有通用的双后端适配层。'], 17))
    return '\n'.join(parts) + '\n</g></svg>\n'


def render_mermaid():
    """输出与总图相同的领域、节点和连线，便于后续编辑。"""
    lines = ['flowchart TD']
    for region, _, _, _, _, label, _ in regions:
        lines.append('  subgraph {}["{}"]'.format(region, label))
        members = [node for node in nodes if node[1] == region]
        if not members:
            lines.append('    {}Node["{}"]'.format(region, label))
        for identity, _, _, _, _, _, _, rows in members:
            lines.append('    {}["{}"]'.format(identity, '<br/>'.join(rows)))
        lines.append('  end')
    for start, end, label, _, both, _ in edges:
        lines.append('  {} {}|"{}"| {}'.format(start, '<-->' if both else '-->', label, end))
    lines.extend([
        '  classDef web fill:#edf2ff,stroke:#3157d5;',
        '  classDef acp fill:#fff5e5,stroke:#9a5a15;',
        '  classDef shared fill:#eaf5ef,stroke:#28734d;',
        '  class webUi,webRuntime,webEntry web;',
        '  class acpUi,acpSdk,acpEntry acp;',
        '  class shared shared;',
    ])
    return '\n'.join(lines) + '\n'


if __name__ == '__main__':
    (destination / 'overview.svg').write_text(render_svg(), encoding='utf-8')
    (destination / 'overview.mmd').write_text(render_mermaid(), encoding='utf-8')
    print('已生成 Web / ACP 对照 SVG 与 Mermaid 图源。')
