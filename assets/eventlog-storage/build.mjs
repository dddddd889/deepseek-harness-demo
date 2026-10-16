import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// 图源与 SVG 使用同一份消息定义，确保离线网页和 Mermaid 展示相同的时序。
const diagrams = [
  {
    id: 'storage',
    title: '建议方案：大产物、会话提交与历史归档',
    actors: ['Agent / 工具执行器', '对象存储', '会话数据库', '归档任务'],
    rows: [
      [0, 1, '写入大产物与内容哈希'],
      [1, 0, '确认对象已持久保存', true],
      [0, 2, '提交事件、序号和产物引用'],
      [2, 0, '确认达到约定耐久边界', true],
      [3, 2, '读取可归档的已提交事件段'],
      [2, 3, '返回事件、Header 与版本', true],
      [3, 1, '写入压缩归档段和校验信息'],
      [1, 3, '确认归档对象已保存', true],
      [3, 3, '验证完整性与恢复能力'],
      [3, 2, '发布归档索引和已验证水位'],
      [3, 3, '按策略清理可淘汰热副本'],
    ],
    note: '对象与数据库没有天然跨系统事务；失败补偿与引用保留另见正文。',
  },
  {
    id: 'quota',
    title: '建议方案：额度预占、实际结算与会话关联',
    actors: ['Agent Loop', '账号额度账本', '模型服务', '会话日志'],
    rows: [
      [0, 1, '以请求尝试身份预占 8 元'],
      [1, 1, '事务检查并记录预占 R1'],
      [1, 0, '返回预占成功与编号 R1', true],
      [0, 3, '持久记录请求与 R1 关联'],
      [0, 2, '发起受预算约束的模型调用'],
      [2, 0, '返回响应与可核验用量', true],
      [0, 1, '按 R1 提交实际费用 3 元'],
      [1, 1, '幂等结算并释放剩余 5 元'],
      [1, 0, '返回结算回执', true],
      [0, 3, '追加用量及结算关联事实'],
    ],
    note: '此图为成功路径；请求结果未知时保留待对账状态，不直接释放全部预占。',
  },
  {
    id: 'warehouse',
    title: '建议方案：数据库先提交，数仓异步接收',
    actors: ['业务写入方', '业务数据库', 'Outbox 导出器', '分析库 / 数仓'],
    rows: [
      [0, 1, '同一事务写事件与待发送记录'],
      [1, 0, '事务提交成功', true],
      [0, 0, '继续产品流程，不等待数仓'],
      [2, 1, '领取已提交的待发送批次'],
      [1, 2, '返回稳定事件身份与内容', true],
      [2, 3, '按事件身份幂等写入原始层'],
      [3, 2, '确认该批次已可靠接收', true],
      [2, 1, '记录交付确认与消费进度'],
      [3, 3, '去重、配对，生成调用明细'],
      [3, 3, '按版本更新日报与分析结果'],
    ],
    note: '写入成功但确认丢失时会重投；进度记录与下游幂等处理必须配合。',
  },
];

// 输出到当前资产目录；不扫描或改写其他课程图。
const directory = fileURLToPath(new URL('.', import.meta.url));

// 转义 SVG 文本与属性中的特殊字符。
function escapeXml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

// 按中英文显示宽度换行，使相邻生命线之间的说明保持可读。
function wrapText(value, limit) {
  // 每行文本、正在累积的文本与显示宽度。
  const lines = [];
  let current = '';
  let width = 0;
  for (const character of value) {
    // 中文按两格估算，英文和数字按一格估算。
    const size = character.codePointAt(0) > 255 ? 2 : 1;
    if (width + size > limit && current) {
      lines.push(current);
      current = '';
      width = 0;
    }
    current += character;
    width += size;
  }
  if (current) lines.push(current);
  return lines;
}

// 构建居中多行文字；字号、行距和画布定位均由调用方明确提供。
function textAt(x, y, value, limit = 34, size = 15) {
  // 换行后的文字行。
  const lines = wrapText(value, limit);
  return `<text x="${x}" y="${y}" text-anchor="middle" font-size="${size}">${lines.map((line, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : 19}">${escapeXml(line)}</tspan>`).join('')}</text>`;
}

// 显式绘制箭头，不依赖外部脚本或字体资源。
function arrow(points, dashed) {
  // 末段方向用于计算箭头两翼。
  const [x, y] = points.at(-1);
  const [previousX, previousY] = points.at(-2);
  const length = Math.hypot(x - previousX, y - previousY);
  const directionX = (x - previousX) / length;
  const directionY = (y - previousY) / length;
  return `<polyline points="${points.map(point => point.join(',')).join(' ')}" fill="none" stroke="#526bb0" stroke-width="2"${dashed ? ' stroke-dasharray="6 5"' : ''}/><polygon points="${x},${y} ${x - 10 * directionX + 5 * directionY},${y - 10 * directionY - 5 * directionX} ${x - 10 * directionX - 5 * directionY},${y - 10 * directionY + 5 * directionX}" fill="#526bb0"/>`;
}

// 从同一图定义生成静态 SVG；它表达消息顺序，不声明跨系统原子提交。
function renderSvg(diagram) {
  // 固定列位置、画布高度和逐段输出。
  const columns = [140, 400, 660, 920];
  const height = 240 + diagram.rows.length * 88;
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="1060" height="${height}" viewBox="0 0 1060 ${height}" role="img" aria-labelledby="title"><title id="title">${escapeXml(diagram.title)}</title><rect width="1060" height="${height}" fill="#fbfcfe"/><g font-family="PingFang SC,Microsoft YaHei,sans-serif" fill="#172033">`, textAt(530, 35, diagram.title, 110, 21)];
  diagram.actors.forEach((actor, index) => {
    // 参与者的生命线横坐标。
    const x = columns[index];
    parts.push(`<line x1="${x}" y1="123" x2="${x}" y2="${height - 95}" stroke="#b7c3d6" stroke-dasharray="6 5"/><rect x="${x - 110}" y="70" width="220" height="53" rx="9" fill="#edf2ff" stroke="#9baedc"/>`, textAt(x, 102, actor, 30, 17));
  });
  diagram.rows.forEach(([from, to, message, reply = false], index) => {
    // 当前消息的端点坐标与垂直位置。
    const start = columns[from];
    const end = columns[to];
    const y = 190 + index * 88;
    if (from === to) {
      // 自调用箭头朝有余量的画布内侧绘制，防止最后一列越界。
      const side = from === 3 ? -1 : 1;
      parts.push(arrow([[start, y], [start + side * 85, y], [start + side * 85, y + 24], [start, y + 24]], false));
      parts.push(textAt(start + side * 80, y - 38, `${index + 1}. ${message}`, 30));
    } else {
      parts.push(arrow([[start, y], [end, y]], reply));
      parts.push(textAt((start + end) / 2, y - 40, `${index + 1}. ${message}`, Math.max(30, Math.abs(end - start) / 8)));
    }
  });
  parts.push(`<rect x="30" y="${height - 74}" width="1000" height="54" rx="9" fill="#fff6e5" stroke="#dcc394"/>`, textAt(530, height - 42, diagram.note, 120, 15), '</g></svg>\n');
  return parts.join('');
}

// 从同一图定义生成可编辑 Mermaid 图源。
function renderMermaid(diagram) {
  // Mermaid 使用稳定英文别名，展示文字保留中文。
  const lines = ['sequenceDiagram', `    %% ${diagram.title}`];
  diagram.actors.forEach((actor, index) => lines.push(`    participant P${index} as ${actor}`));
  diagram.rows.forEach(([from, to, message, reply = false]) => lines.push(`    P${from}${reply ? '-->>' : '->>'}P${to}: ${message}`));
  lines.push(`    Note over P0,P3: ${diagram.note}`);
  return lines.join('\n') + '\n';
}

await mkdir(directory, { recursive: true });
for (const diagram of diagrams) {
  await writeFile(new URL(`${diagram.id}.svg`, import.meta.url), renderSvg(diagram));
  await writeFile(new URL(`${diagram.id}.mmd`, import.meta.url), renderMermaid(diagram));
}
console.log(`已生成 ${diagrams.length} 组 Event Log 时序图与 Mermaid 图源。`);
