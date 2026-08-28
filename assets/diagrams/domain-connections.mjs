// 连线由同一份数据生成 SVG、Mermaid 和页面说明；分类不是执行顺序。
const relations = [
  ['frontend0', 'frontend3', '装配插槽', 'assembly'],
  ['frontend1', 'frontend2', '同步事件', 'event'],
  ['frontend2', 'frontend3', '提供状态', 'event'],
  ['frontend3', 'frontend4', '渲染对话', 'call'],
  ['frontend3', 'frontend5', '渲染工作台', 'call'],
  ['server0', 'server1', '承载接口', 'assembly'],
  ['server4', 'server1', '约束访问', 'assembly'],
  ['server1', 'server2', '分发操作', 'call'],
  ['server2', 'server3', '会话订阅', 'call'],
  ['core0', 'core1', '驱动循环', 'call'],
  ['core1', 'core3', '准备请求', 'call'],
  ['core3', 'core1', '提供上下文', 'event'],
  ['core1', 'core2', '追加事实', 'event'],
  ['core4', 'core0', '创建或继续', 'call'],
  ['core5', 'core4', '任务编排', 'call'],
  ['execution1', 'execution2', '执行检查', 'call'],
  ['execution2', 'execution3', '允许后执行', 'call'],
  ['execution1', 'execution4', '接入能力', 'call'],
  ['execution3', 'execution5', '处理结果', 'event'],
  ['storage0', 'storage1', '追加提交', 'storage'],
  ['storage1', 'storage2', '读取历史', 'storage'],
  ['storage1', 'storage3', '派生索引', 'storage'],
  ['observability0', 'observability1', '投影脱敏', 'telemetry'],
  ['observability1', 'observability2', '交接记录', 'telemetry'],
  ['observability2', 'observability3', 'OTLP 导出', 'telemetry'],
  ['foundation1', 'foundation0', '装配插件', 'assembly'],
  ['foundation2', 'foundation1', '提供产物', 'assembly'],
  ['foundation3', 'foundation5', '回归检查', 'assembly'],
  ['foundation5', 'foundation1', '检查配置', 'assembly'],
  ['foundation3', 'foundation2', '校验构建', 'assembly'],
  ['frontend1', 'server1', 'HTTP 请求', 'call'],
  ['server3', 'frontend1', '双 WS 推送', 'event'],
  ['server2', 'core0', '会话操作', 'call'],
  ['server5', 'core0', '无界面调用', 'call'],
  ['core2', 'server3', '事件与投影', 'event'],
  ['core1', 'execution0', '模型请求', 'call'],
  ['execution0', 'core2', '记录响应', 'event'],
  ['core1', 'execution1', '调度工具', 'call'],
  ['execution5', 'core2', '记录结果', 'event'],
  ['core2', 'storage0', '写入事实', 'storage'],
  ['storage2', 'core0', '恢复会话', 'storage'],
  ['execution5', 'storage5', '保存产物', 'storage'],
  ['core2', 'observability0', '捕获副本', 'telemetry'],
  ['core2', 'observability4', '派生统计', 'event'],
  ['foundation1', 'storage4', '配置路由', 'assembly'],
  ['foundation0', 'core0', '服务与生命周期', 'assembly'],
  ['foundation4', 'core1', '断点调试', 'assembly'],
  ['observability5', 'core1', '检查不变量', 'assembly'],
];

// 同色线表达同类关系；只有遥测与横切支撑使用虚线。
const kinds = {
  call: ['#2563a6', '请求与调用'],
  event: ['#087d78', '事件与状态回传'],
  storage: ['#a45b09', '持久化、恢复与产物'],
  telemetry: ['#a03383', '观测副本导出'],
  assembly: ['#697386', '装配、检查与调试'],
};
// 输出内容均转义，避免标题或关系标签破坏 SVG / HTML。
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
// 采用独立文本节点，确保离线 SVG 渲染器也能显示换行。
function text(x, y, value, size = 18, limit = 60) {
  return Array.from({ length: Math.ceil(value.length / limit) }, (_, i) => `<text x="${x}" y="${y + i * 24}" font-size="${size}">${escape(value.slice(i * limit, (i + 1) * limit))}</text>`).join('');
}

// 领域上下排列；节点之间留路由通道，跨领域线从左右外侧通行，不穿过节点。
export function renderDomains(groups) {
  const width = 1600, height = 4620;
  const boxes = new Map(), counters = new Map();
  const background = [], nodes = [], lines = [], labels = [];
  const mermaid = ['flowchart TD'];
  const next = key => { const value = counters.get(key) ?? 0; counters.set(key, value + 1); return value; };
  for (const [index, group] of groups.entries()) {
    const y = 220 + index * 620;
    background.push(`<rect x="180" y="${y}" width="1240" height="590" rx="14" fill="${group.color}" stroke="#c4cbd4"/>`, text(205, y + 35, `${index + 1}. ${group.title}`, 24), text(205, y + 556, group.relation, 17, 67));
    mermaid.push(`  subgraph ${group.id}["${group.title}"]`);
    for (const [number, [title, subtitle]] of group.nodes.entries()) {
      const id = group.id + number, x = 220 + number % 3 * 400, top = y + 160 + Math.floor(number / 3) * 210;
      boxes.set(id, { id, group: group.id, groupY: y, x, y: top, row: Math.floor(number / 3), width: 350, height: 90, title });
      nodes.push(`<g data-node="${id}" tabindex="0" aria-label="${escape(title)}"><rect x="${x}" y="${top}" width="350" height="90" rx="9" fill="white" stroke="#98a2b3"/>`, text(x + 12, top + 29, title, 20, 17), text(x + 12, top + 59, subtitle, 16, 23), '</g>');
      mermaid.push(`    ${id}["${title}"]`);
    }
    mermaid.push('  end');
  }
  const table = ['    <details class="domain-connections"><summary>查看全部 48 条连线：起点、终点与含义</summary><p>连线表示选取的关键调用或数据关系，不是逐包导入图；领域间穿越处没有圆点就不表示连接。编号与总图一致。</p><table><thead><tr><th>编号 / 类型</th><th>起点 → 终点</th><th>关系</th></tr></thead><tbody>'];
  let cross = 0;
  for (const [index, [from, to, label, kind]] of relations.entries()) {
    const a = boxes.get(from), b = boxes.get(to), id = `R${String(index + 1).padStart(2, '0')}`;
    if (!a || !b) throw new Error(`连线 ${id} 缺少节点`);
    const color = kinds[kind][0], dashed = ['telemetry', 'assembly'].includes(kind);
    // 每个端口单独分配横向偏移，减少多线在同一点重叠。
    const ax = a.x + 75 + next(from + ':port') * 22, bx = b.x + 75 + next(to + ':port') * 22;
    let points, labelX, labelY;
    if (a.group === b.group) {
      if (a.row === b.row) {
        const lane = next(a.group + ':' + a.row + ':local');
        const y = a.y - 30 - lane * 27;
        points = [[ax, a.y], [ax, y], [bx, y], [bx, b.y]];
        labelX = Math.min(ax, bx) + 25; labelY = y - 5;
      } else {
        const y = a.groupY + 275 + next(a.group + ':middle') * 25;
        const ay = a.row === 0 ? a.y + a.height : a.y, by = b.row === 0 ? b.y + b.height : b.y;
        points = [[ax, ay], [ax, y], [bx, y], [bx, by]];
        labelX = Math.min(ax, bx) + 25; labelY = y - 5;
      }
    } else {
      const lane = cross++, right = lane % 2 === 0;
      const x = right ? 1445 + Math.floor(lane / 2) * 15 : 155 - Math.floor(lane / 2) * 15;
      // 按整行分配通道，避免来自不同节点的跨域线意外重合成一条总线。
      const outLane = next(a.group + ':' + a.row + ':out');
      const ay = a.y + a.height + 19 + outLane * 13;
      const by = b.y - 18 - next(b.group + ':' + b.row + ':in') * 13;
      points = [[ax, a.y + a.height], [ax, ay], [x, ay], [x, by], [bx, by], [bx, b.y]];
      labelX = right ? 1225 - (outLane % 2) * 220 : 195 + (outLane % 2) * 220; labelY = ay - 5;
    }
    const [endX, endY] = points.at(-1), [lastX, lastY] = points.at(-2);
    const length = Math.hypot(endX - lastX, endY - lastY), dx = (endX - lastX) / length, dy = (endY - lastY) / length;
    const arrow = `${endX},${endY} ${endX - 10 * dx + 5 * dy},${endY - 10 * dy - 5 * dx} ${endX - 10 * dx - 5 * dy},${endY - 10 * dy + 5 * dx}`;
    // 透明宽路径扩大细线命中区域；真实线条仍保持原有粗细。
    lines.push(`<g data-edge="${id}" data-from="${from}" data-to="${to}" data-kind="${kind}" tabindex="0" aria-label="${id} ${escape(label)}"><title>${id} ${escape(a.title)} → ${escape(b.title)}：${escape(label)}</title><path class="edge-hit" d="M${points.map(p => p.join(',')).join(' L')}" fill="none" stroke="transparent" stroke-width="16" pointer-events="stroke"/><polyline points="${points.map(p => p.join(',')).join(' ')}" fill="none" stroke="${color}" stroke-width="2"${dashed ? ' stroke-dasharray="7 5"' : ''}/><polygon points="${arrow}" fill="${color}"/></g>`);
    const caption = `${id} ${label}`, labelWidth = 46 + label.length * 17;
    labels.push(`<g data-edge-label="${id}" fill="${color}"><rect x="${labelX - 3}" y="${labelY - 17}" width="${labelWidth}" height="22" rx="4" fill="#fff" fill-opacity=".96"/>${text(labelX, labelY, caption, 16)}</g>`);
    mermaid.push(`  ${from} ${dashed ? '-.->' : '-->'}|"${caption}"| ${to}`);
    table.push(`      <tr data-edge="${id}"><th scope="row">${id} · ${kinds[kind][1]}</th><td>${a.title} → ${b.title}</td><td>${label}</td></tr>`);
  }
  table.push('    </tbody></table></details>');
  // 纯 CSS 联动，无需页面脚本；悬浮与键盘聚焦采用相同的高亮规则。
  const styles = ['[data-node],[data-edge],[data-edge-label]{cursor:pointer;outline:none}', '[data-node]:is(:hover,:focus-visible)>rect{fill:#fff2c2;stroke:#b56b00;stroke-width:3}', '[data-node]:is(:hover,:focus-visible)>text{font-weight:700}'];
  for (const [index, [from, to]] of relations.entries()) {
    const id = `R${String(index + 1).padStart(2, '0')}`;
    const edgeActive = `:root:has([data-edge="${id}"]:is(:hover,:focus-visible),[data-edge-label="${id}"]:hover)`;
    const related = `:root:has([data-node="${from}"]:is(:hover,:focus-visible),[data-node="${to}"]:is(:hover,:focus-visible),[data-edge="${id}"]:is(:hover,:focus-visible),[data-edge-label="${id}"]:hover)`;
    // 起点和终点等价匹配：入线、出线及箭头全部高亮，保留虚实线语义。
    styles.push(`${related} [data-edge="${id}"]>polyline{stroke:#d97706;stroke-width:5}`, `${related} [data-edge="${id}"]>polygon{fill:#d97706}`, `${related} [data-edge-label="${id}"]>text{fill:#92400e;font-weight:700}`, `${related} [data-edge-label="${id}"]>rect{fill:#fff2c2}`, `${edgeActive} :is([data-node="${from}"],[data-node="${to}"])>rect{fill:#fff2c2;stroke:#b56b00;stroke-width:3}`, `${edgeActive} :is([data-node="${from}"],[data-node="${to}"])>text{font-weight:700}`);
  }
  const svg = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title"><title id="title">全站总体架构：七个领域、42 个子系统与48条连线</title><rect width="${width}" height="${height}" fill="#fbfcfe"/><g font-family="PingFang SC,Microsoft YaHei,sans-serif" fill="#172033">`, text(180, 45, '全站总体架构 · 领域边界、内部协作与跨领域数据流', 27), text(180, 80, '保留 42 个子系统；箭头表示调用或数据方向，虚线表示观测或横切支撑。交叉处不表示连接。', 18)];
  Object.entries(kinds).forEach(([key, [color, name]], index) => {
    const x = 180 + index * 248;
    svg.push(`<path d="M${x} 119 h35" stroke="${color}" stroke-width="3"${['telemetry', 'assembly'].includes(key) ? ' stroke-dasharray="6 4"' : ''}/>`, text(x + 42, 125, name, 16));
  });
  svg.push(text(180, 163, '请求：R31 → R33 → R36 / R38；回传：R35 / R32；恢复：R40 / R41；观测：R43。', 17, 100), text(180, 191, '线上的 R 编号可在页面“全部连线”中查找；具体能力是否挂载取决于产品装配。', 17), ...background, ...lines, ...nodes, ...labels, text(180, 4600, '权威存储、派生索引、观测存储各自独立；Headless 走 R34，不需要 Web 服务入口。', 18), '</g></svg>\n');
  return { svg: svg.join('').replace('</title>', '</title><style>' + styles.join('\n') + '</style>'), mermaid: mermaid.join('\n') + '\n', connections: table.join('\n') };
}
