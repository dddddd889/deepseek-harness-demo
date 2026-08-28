import { readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { contexts } from './context-data.mjs';

// 维护统一的课程概念地图；坐标不表示某框架的真实包布局或默认装配。
const directory = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(directory, '../..');
const coordinates = {
  1: [50, 110], 2: [460, 110], 3: [870, 110],
  16: [460, 270], 15: [460, 420], 14: [50, 420],
  13: [50, 570], 6: [460, 570], 5: [870, 570],
  4: [50, 720], 11: [870, 720], 7: [460, 900], 9: [870, 900],
  10: [50, 1030], 8: [460, 1180], 12: [870, 1180], 17: [50, 1180],
};
// 仅画帮助定位的核心关系；未连线不代表不存在其他依赖。
const edges = [
  [16, 15, '远程交互', '590,348 590,420', 660, 390],
  [15, 6, '会话操作', '590,498 590,570', 660, 540],
  [14, 6, '装配运行时', '310,459 365,459 365,580 460,580', 360, 530],
  [13, 6, '创建或委派', '310,615 460,615', 380, 645],
  [6, 5, '模型调用', '720,609 870,609', 795, 595],
  [6, 4, '记录事实', '460,640 430,640 430,690 180,690 180,720', 285, 680],
  [4, 10, '保存与加载', '180,798 180,1030', 255, 950],
  [4, 11, '提供历史', '310,759 870,759', 590, 745],
  [11, 5, '准备上下文', '1000,720 1000,648', 1080, 690],
  [6, 7, '调度行动', '590,648 590,900', 675, 845],
  [9, 7, '约束执行', '870,939 720,939', 795, 925],
  [7, 8, '本地操作', '590,978 590,1180', 660, 1100],
  [7, 12, '外部调用', '720,960 820,960 820,1075 1000,1075 1000,1180', 1000, 1105],
  [4, 17, '观测副本', '50,759 25,759 25,1219 50,1219', 105, 1130],
];
// 文本始终转义后嵌入 HTML/SVG，空值统一用短横线占位。
const escape = value => String(value ?? '-').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
// 按中文字符拆行，避免长标题越过节点边界。
function textNode(x, y, value, size = 18, color = '#344054', limit = 16) {
  const rows = [];
  for (const paragraph of value.split('\n')) {
    for (let offset = 0; offset < paragraph.length; offset += limit) rows.push(paragraph.slice(offset, offset + limit));
  }
  // 每行使用独立绝对坐标，避免系统渲染器忽略 tspan 的换行定位。
  return rows.map((row, index) => `<text x="${x}" y="${y + index * 25}" text-anchor="middle" font-size="${size}" fill="${color}">${escape(row)}</text>`).join('');
}
// 使用显式箭头多边形，兼容系统离线 SVG 渲染器。
function arrow(points) {
  const vertices = points.split(' ').map(pair => pair.split(',').map(Number));
  const [x, y] = vertices.at(-1), [px, py] = vertices.at(-2);
  const length = Math.hypot(x - px, y - py), ux = (x - px) / length, uy = (y - py) / length;
  return `<polyline points="${points}" fill="none" stroke="#98a2b3" stroke-width="2"/><polygon points="${x},${y} ${x - 10 * ux + 5 * uy},${y - 10 * uy - 5 * ux} ${x - 10 * ux - 5 * uy},${y - 10 * uy + 5 * ux}" fill="#98a2b3"/>`;
}
// SVG 与 Mermaid 从同一节点、关系和当前课号生成，防止两份图源漂移。
function diagram(current) {
  const title = `第 ${current} 课 · ${contexts[current - 1].title}的系统位置`;
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1340" viewBox="0 0 1200 1340" role="img" aria-labelledby="title"><title id="title">${escape(title)}</title><rect width="1200" height="1340" fill="#fbfcfe"/><g font-family="PingFang SC,Microsoft YaHei,sans-serif">`, textNode(600, 35, title, 23, '#172033', 70), textNode(600, 78, '横切底座：第 1～3 课支撑全系统，不是按顺序执行的三个步骤', 16, '#667085', 75)];
  parts.push('<rect x="35" y="95" width="1110" height="108" rx="12" fill="#f2f4f7"/>');
  for (const [,, label, points, x, y] of edges) parts.push(arrow(points));
  for (const [,, label,, x, y] of edges) {
    parts.push(`<rect x="${x - 53}" y="${y - 18}" width="106" height="24" rx="4" fill="#fbfcfe"/>`, textNode(x, y, label, 15));
  }
  for (const [number, [x, y]] of Object.entries(coordinates)) {
    const active = Number(number) === current, label = `第 ${number} 课：\n${contexts[number - 1].title}`;
    parts.push(`<rect x="${x}" y="${y}" width="260" height="78" rx="12" fill="${active ? '#fff0c2' : '#f2f4f7'}" stroke="${active ? '#b46b00' : '#c4cbd4'}" stroke-width="${active ? 3 : 1}"/>`, textNode(x + 130, y + 29, label, 18, active ? '#784000' : '#475467', 13));
  }
  parts.push(textNode(600, 1300, '橙色：本课职责；灰色：系统其余部分。箭头为选取的关系，交叉处不表示连接。', 15, '#667085', 85), '</g></svg>\n');
  const source = ['flowchart TD', ...Object.keys(coordinates).map(number => `  c${number}["第 ${number} 课：${contexts[number - 1].title}"]`), ...edges.map(([from, to, label]) => `  c${from} -->|"${label}"| c${to}`), '  classDef current fill:#fff0c2,stroke:#b46b00,stroke-width:3px', `  class c${current} current`, ''].join('\n');
  return [parts.join(''), source];
}
// 页面区块带稳定边界标记，后续再生成时可整体替换，不覆盖原有课程正文。
function section(number, context) {
  const id = String(number).padStart(4, '0');
  const names = ['DeepSeek Harness 原实现', 'LangChain DeepAgents', 'OpenHands Software Agent SDK'];
  const markup = ['  <!-- 章节定位与对比：开始 -->', '  <section id="system-position">', '  <h2>本章在全系统中的位置</h2>',
    `  <p>${escape(context.position)}</p>`,
    '  <p>下面是本课程的概念地图，不是某框架的逐包调用图，也不表示实验室已默认装配全部能力。三套框架的实际对应关系见上方横向对比表。</p>',
    `  <figure class="course-diagram"><figcaption>全系统定位 · 橙色高亮第 ${number} 课</figcaption><a href="../assets/diagrams/${id}-position.svg"><img src="../assets/diagrams/${id}-position.svg" alt="${escape(context.title)}在全系统中的位置，橙色为本课职责" loading="lazy"></a><p><a href="../assets/diagrams/${id}-position.svg">打开大图</a> · <a href="../assets/diagrams/${id}-position.mmd">Mermaid 图源</a></p></figure>`,
    '  <table><tbody>',
    `    <tr><th>上游与输入</th><td>${escape(context.input)}</td></tr>`,
    `    <tr><th>下游与输出</th><td>${escape(context.output)}</td></tr>`,
    `    <tr><th>不归本章负责</th><td>${escape(context.boundary)}</td></tr>`,
    `    <tr><th>放进具体场景</th><td>${escape(context.scenario)}</td></tr>`,
    '  </tbody></table>', '  <p>接着看下方「可视化图解」：局部模块图解释职责，时序图解释一次调用，分支图解释异常与边界。</p>', '  </section>',
    '  <section id="framework-comparison">', '  <h2>本章对比：DeepSeek Harness / DeepAgents / OpenHands</h2>',
    '  <p>口径：DeepSeek 依据本地原仓库（99f6f02fecdb），不是 harness-lab；deepagent 按 LangChain DeepAgents 理解；OpenHands 对比当前 Software Agent SDK，不混用旧 V0。在线资料核对于 2026-08-28，描述文档能力，不代表已在本实验室安装或测试。没有依据的同名能力不强行等同。</p>',
    `  <div class="comparison-scroll"><table class="framework-matrix"><thead><tr><th>比较维度</th>${names.map(name => `<th scope="col">${name}</th>`).join('')}</tr></thead><tbody>`,
    ...[['mechanism', '本章由谁负责、怎么实现'], ['boundary', '与另外两者的边界差异'], ['sources', '核对实现的一手依据']].map(([field, label]) => `    <tr data-dimension="${field}"><th scope="row">${label}</th>${context.frameworks.map((entry, index) => `<td data-framework="${['deepseek', 'deepagents', 'openhands'][index]}">${field === 'sources' ? entry.sources.map((source, i) => `<a href="${escape(source)}">${index ? '官方文档' : '原仓库依据'} ${i + 1}</a>`).join(' · ') : escape(entry[field])}</td>`).join('')}</tr>`),
    '  </tbody></table></div>', `  <p class="callout"><strong>三者的关键区别：</strong>${escape(context.insight)}（基于上述依据的归纳）</p>`, '  </section>', '  <!-- 章节定位与对比：结束 -->', ''].join('\n');
  // 把实际对比放在大图之前；页内导航和首页总表提供明确入口。
  // 章级摘要折叠为辅助信息，阅读入口优先通往正文概念。
  const comparison = markup.match(/  <section id="framework-comparison">[\s\S]*?<\/section>/)[0].replace('<section id="framework-comparison">', '<section id="framework-comparison"><details><summary>章节概览（可选）：三框架职责摘要</summary>').replace('</section>', '</details></section>');
  const position = markup.match(/  <section id="system-position">[\s\S]*?<\/section>/)[0];
  return ['  <!-- 章节定位与对比：开始 -->', '  <nav aria-label="本课阅读导航"><a href="#concept-index">概念逐项对比</a> · <a href="#system-position">本章系统位置</a> · <a href="#visual-diagrams">局部图解</a> · <a href="#framework-comparison">章节概览（可选）</a></nav>', comparison, position, '  <!-- 章节定位与对比：结束 -->', ''].join('\n');
}

const files = await readdir(join(root, 'lessons'));
const patches = [];
for (const [index, context] of contexts.entries()) {
  const number = index + 1, id = String(number).padStart(4, '0');
  const [svg, source] = diagram(number);
  await writeFile(join(directory, `${id}-position.svg`), svg);
  await writeFile(join(directory, `${id}-position.mmd`), source);
  const filename = files.find(file => file.startsWith(id + '-') && file.endsWith('.html'));
  if (!filename) throw new Error(`没有找到第 ${number} 课页面`);
  const path = join(root, 'lessons', filename), html = await readFile(path, 'utf8');
  const addition = section(number, context);
  const old = html.match(/  <!-- 章节定位与对比：开始 -->[\s\S]*?  <!-- 章节定位与对比：结束 -->\n/)?.[0];
  if (old === addition) continue;
  if (old) patches.push(`*** Update File: ${path}\n@@\n${old.trimEnd().split('\n').map(line => '-' + line).join('\n')}\n${addition.trimEnd().split('\n').map(line => '+' + line).join('\n')}`);
  else patches.push(`*** Update File: ${path}\n@@\n${addition.split('\n').map(line => '+' + line).join('\n')}\n   <section id="visual-diagrams">`);
}
// 首页使用同一份逐课数据生成三列并排总表，避免首页和课程内容不一致。
const roadmapPath = join(root, 'reference/deepseek-harness-build-roadmap.html');
const roadmap = await readFile(roadmapPath, 'utf8');
const overview = ['  <!-- 三框架总表：开始 -->', '  <section id="framework-overview">', '  <h2>17 课横向对比：DeepSeek Harness / DeepAgents / OpenHands</h2>', '  <p>每一行是同一个章节主题，三列分别回答三套框架如何实现。DeepSeek 指原仓库而非实验室；DeepAgents 指 LangChain DeepAgents；OpenHands 指当前 Software Agent SDK。资料核对日期：2026-08-28。点击章节进入详细边界、证据链接与系统定位图。</p>', '  <div class="comparison-scroll"><table class="framework-matrix"><thead><tr><th>章节 / 同一问题</th><th scope="col">DeepSeek Harness</th><th scope="col">LangChain DeepAgents</th><th scope="col">OpenHands SDK</th></tr></thead><tbody>', ...contexts.map((context, index) => {
  const id = String(index + 1).padStart(4, '0');
  const filename = files.find(file => file.startsWith(id + '-') && file.endsWith('.html'));
  return `    <tr data-chapter="${id}"><th scope="row"><a href="../lessons/${filename}#framework-comparison">${index + 1}. ${escape(context.title)}</a></th>${context.frameworks.map(entry => `<td>${escape(entry.mechanism)} <a href="${escape(entry.sources[0])}">依据</a></td>`).join('')}</tr>`;
}), '  </tbody></table></div>', '  </section>', '  <!-- 三框架总表：结束 -->', ''].join('\n');
const oldOverview = roadmap.match(/  <!-- 三框架总表：开始 -->[\s\S]*?  <!-- 三框架总表：结束 -->\n/)?.[0];
if (oldOverview !== overview) {
  if (oldOverview) patches.push(`*** Update File: ${roadmapPath}\n@@\n${oldOverview.trimEnd().split('\n').map(line => '-' + line).join('\n')}\n${overview.trimEnd().split('\n').map(line => '+' + line).join('\n')}`);
  else patches.push(`*** Update File: ${roadmapPath}\n@@\n${overview.split('\n').map(line => '+' + line).join('\n')}\n   <section id="site-architecture">`);
}
if (process.argv.includes('--embed') && patches.length) console.log('*** Begin Patch\n' + patches.join('\n') + '\n*** End Patch');
else console.log(`已生成 17 张定位图及 Mermaid 图源；待更新页面：${patches.length}。`);
