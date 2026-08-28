import { mkdir, writeFile, readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { lessons } from './course-data.mjs';

// 图像和 Mermaid 共用结构化定义，避免图与可编辑图源分别维护。
const directory = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(directory, '../..');
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const parts = [];
// 按显示宽度分行，中文计两格，英文计一格。
function lines(value, limit = 30) {
  const output = []; let line = ''; let width = 0;
  for (const char of value) {
    const size = char.charCodeAt(0) > 255 ? 2 : 1;
    if (width + size > limit) { output.push(line); line = ''; width = 0; }
    line += char; width += size;
  }
  if (line) output.push(line);
  return output;
}
// 绘制可自动换行的居中文本。
function label(x, y, value, limit = 30, color = '#172033', size = 16) {
  const rows = lines(value, limit);
  parts.push(`<text x="${x}" y="${y}" text-anchor="middle" fill="${color}" font-size="${size}">${rows.map((row, i) => `<tspan x="${x}" dy="${i === 0 ? 0 : 22}">${escape(row)}</tspan>`).join('')}</text>`);
}
// 为连线说明添加底色，避免文字与穿过的连接线重叠。
function edgeLabel(x, y, value, limit = 30) {
  const rows = lines(value, limit);
  const width = Math.max(...rows.map(row => [...row].reduce((sum,char)=>sum+(char.charCodeAt(0)>255?14:8),0)))+14;
  parts.push(`<rect x="${x-width/2}" y="${y-17}" width="${width}" height="${rows.length*22}" rx="4" fill="#fbfcfe"/>`);
  label(x,y,value,limit,'#526bb0',14);
}
// 绘制固定高度的模块或结果节点。
function box(x, y, text, width = 260, color = '#edf2ff') {
  parts.push(`<rect x="${x}" y="${y}" width="${width}" height="78" rx="12" fill="${color}" stroke="#9baedc"/>`);
  const rows = lines(text, 28);
  label(x + width / 2, y + (rows.length > 1 ? 31 : 45), text, 28);
}
// 绘制有向折线，虚线表达返回消息或扩展关系。
function arrow(points, dashed = false) {
  // 显式绘制箭头，兼容不支持 SVG marker 的离线预览器。
  const color = dashed ? '#8b5f20' : '#526bb0';
  const vertices = points.split(' ').map(point => point.split(',').map(Number));
  const [x,y] = vertices.at(-1), [px,py] = vertices.at(-2);
  const length = Math.hypot(x-px,y-py), ux = (x-px)/length, uy = (y-py)/length;
  parts.push(`<polyline points="${points}" fill="none" stroke="${color}" stroke-width="2" ${dashed ? 'stroke-dasharray="7 5"' : ''}/>`);
  parts.push(`<polygon points="${x},${y} ${x-11*ux+5*uy},${y-11*uy-5*ux} ${x-11*ux-5*uy},${y-11*uy+5*ux}" fill="${color}"/>`);
}
// 开始一张具有固定画布和无障碍标题的独立 SVG。
function begin(title, width, height) {
  parts.length = 0;
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title"><title id="title">${escape(title)}</title><rect width="${width}" height="${height}" fill="#fbfcfe"/><g font-family="PingFang SC,Microsoft YaHei,sans-serif">`);
  label(width / 2, 32, title, 100, '#172033', 21);
}
// 收束当前画布。
function finish() { return parts.join('') + '</g></svg>\n'; }
// 以入口、核心及三个职责节点展示本课模块关系。
function moduleSvg(title, nodes, edges) {
  begin(title + ' · 模块关系', 1040, 500);
  arrow('520,158 520,205');
  for (const x of [180, 520, 860]) arrow(`520,283 520,305 ${x},305 ${x},375`);
  box(390, 80, nodes[0]); box(390, 205, nodes[1], 260, '#dce7ff');
  [50, 390, 730].forEach((x, i) => box(x, 375, nodes[i + 2]));
  edgeLabel(700, 185, edges[0]);
  [180,520,860].forEach((x,i)=>edgeLabel(x, 335, edges[i+1], 29));
  return finish();
}
// 绘制参与者生命线和按时间排序的消息箭头。
function sequenceSvg(title, actors, messages) {
  const height = 195 + messages.length * 90;
  begin(title + ' · 调用时序', 1080, height);
  actors.forEach((actor, i) => {
    const x = 145 + i * 260;
    parts.push(`<line x1="${x}" y1="145" x2="${x}" y2="${height - 35}" stroke="#aebad2" stroke-dasharray="6 5"/>`);
    box(x - 115, 65, actor, 230);
  });
  messages.forEach(([from, to, message], index) => {
    const x = 145 + from * 260, end = 145 + to * 260, y = 205 + index * 90;
    if (from === to) {
      arrow(`${x},${y} ${x + 75},${y} ${x + 75},${y + 28} ${x},${y + 28}`);
      label(x + 78, y - 15, `${index + 1}. ${message}`, 25, '#354d83', 14);
    } else {
      arrow(`${x},${y} ${end},${y}`, to < from);
      label((x + end) / 2, y - 32, `${index + 1}. ${message}`, Math.max(26, Math.abs(end - x) / 8), '#354d83', 14);
    }
  });
  return finish();
}
// 绘制条件与处置相配的异常分支，不宣称互斥或覆盖全部故障。
function branchSvg(title, branches) {
  begin(title + ' · 异常与边界分支', 1040, 650);
  parts.push('<path d="M 150 220 L 250 320 L 150 420 L 50 320 Z" fill="#fff3db" stroke="#b89049"/>');
  label(150, 308, '观察到哪种情况？', 14);
  branches.forEach(([condition, outcome], i) => {
    const y = 95 + i * 130;
    arrow(`250,320 280,320 280,${y+39} 340,${y+39}`);
    arrow(`600,${y+39} 690,${y+39}`);
    box(340,y,condition,260,'#fff7e8'); box(690,y,outcome,300,'#eaf5ef');
  });
  label(520, 625, '分支按触发条件分类；不同阶段可能先后触发，不表示一次只会出现一种故障。', 110, '#667085', 14);
  return finish();
}
// Mermaid 图源与 SVG 表达相同节点和边；不依赖浏览器加载任何远程库。
function moduleSource(title, nodes, edges) {
  return `---\ntitle: ${title} · 模块关系\n---\nflowchart TD\n` + nodes.map((node,i)=>`  n${i}["${node}"]`).join('\n') + '\n' + [[0,1],[1,2],[1,3],[1,4]].map(([a,b],i)=>`  n${a} -->|"${edges[i]}"| n${b}`).join('\n') + '\n';
}
// 输出与时序 SVG 相同的参与者和消息。
function sequenceSource(title, actors, messages) {
  return `---\ntitle: ${title} · 调用时序\n---\nsequenceDiagram\n  autonumber\n` + actors.map((a,i)=>`  participant p${i} as ${a}`).join('\n') + '\n' + messages.map(([a,b,m])=>`  p${a}${b<a?'-->>':'->>'}p${b}: ${m}`).join('\n') + '\n';
}
// 输出与分支 SVG 相同的条件与处置。
function branchSource(title, branches) {
  return `---\ntitle: ${title} · 异常与边界分支\n---\nflowchart TD\n  decision{"观察到哪种情况？"}\n` + branches.map(([c,o],i)=>`  decision -->|"${c}"| result${i}["${o}"]`).join('\n') + '\n';
}
// 总体图显式区分默认宿主链路与可选教学扩展。
function overview() {
  begin('全站总体架构 · 当前运行链路与教学扩展', 1140, 1090);
  const nodes = [
    ['web',420,70,'网页 / AgentClient'],['server',420,210,'AgentServer：RPC / SSE'],
    ['host',420,350,'HeadlessHost'],['cli',40,350,'CLI'],['config',40,210,'Profile / Bundle / Context'],
    ['agent',420,490,'HarnessAgent'],['session',40,650,'Session 事件账本'],['llm',800,650,'LlmRuntime / DeepSeek'],
    ['store',40,810,'JSONL 存储 / 冷恢复'],['projection',420,810,'消息、用量、客户端投影'],
    ['extensions',800,810,'工具 / 本地 / 权限 / 外部能力'],['orchestration',800,950,'子智能体 / Jobs / Workflow'],
    ['observe',420,950,'遥测 Sink / 成本 / 发布加固']
  ];
  const edges = [
    ['web','server','请求与事件'],['server','host','会话路由'],['cli','host','直接用例调用'],
    ['config','host','装配'],['host','agent','创建会话智能体'],['agent','session','追加事件'],
    ['agent','llm','生成'],['session','store','写入与恢复'],['session','projection','重放'],
    ['session','observe','独立示例直接消费事件'],['agent','extensions','可选注入，非默认',true],
    ['extensions','orchestration','独立教学扩展',true]
  ];
  // 为总图显式布线，避免自动布局把实际链路和扩展边界混为一体。
  const paths = ['550,148 550,210','550,288 550,350','300,389 420,389','300,249 345,249 345,370 420,370','550,428 550,490','420,529 170,529 170,650','680,529 930,529 930,650','170,728 170,810','300,689 365,689 365,849 420,849','300,708 330,708 330,989 420,989','680,548 750,548 750,849 800,849','930,888 930,950'];
  paths.forEach((path,i)=>arrow(path,Boolean(edges[i][3])));
  arrow('578,210 578,148');
  edges.push(['server','web','RPC 返回与 SSE 事件']);
  nodes.forEach(([,x,y,text])=>box(x,y,text,260));
  const captions = [[770,185],[700,320],[345,425],[250,315],[740,465],[275,575],[865,575],[170,770],[440,755],[465,925],[900,775],[930,925],[335,175]];
  captions.forEach(([x,y],i)=>edgeLabel(x,y,edges[i][2],42));
  edgeLabel(550, 470, '当前宿主未注入 ToolRegistry', 50);
  label(570, 610, 'Session 是恢复事实源', 50, '#526bb0', 16);
  label(570, 1065, '实线：当前实现关系；虚线：可选或独立教学扩展。遥测 Sink 不代表已连接远程 Collector。', 145, '#667085', 14);
  const mmd = 'flowchart TD\n' + nodes.map(([id,,,text])=>`  ${id}["${text}"]`).join('\n') + '\n' + edges.map(([a,b,l,d])=>`  ${a} ${d?'-.->':'-->'}|"${l}"| ${b}`).join('\n')+'\n';
  return [finish(),mmd];
}

await mkdir(directory,{recursive:true});
const patches = [];
const filenames = await readdir(join(root,'lessons'));
// 只生成由此脚本拥有的图像；页面修改输出为 apply_patch 补丁。
for (const [id,title,nodes,edges,actors,messages,branches] of lessons) {
  const variants = [['modules','模块关系',moduleSvg(title,nodes,edges),moduleSource(title,nodes,edges)],['sequence','调用时序',sequenceSvg(title,actors,messages),sequenceSource(title,actors,messages)],['branches','异常分支',branchSvg(title,branches),branchSource(title,branches)]];
  for (const [kind,,svg,mmd] of variants) {
    await writeFile(join(directory,`${id}-${kind}.svg`),svg);
    await writeFile(join(directory,`${id}-${kind}.mmd`),mmd);
  }
  const filename = filenames.find(name=>name.startsWith(id+'-') && name.endsWith('.html'));
  if (!filename) throw new Error(`未找到第 ${id} 课`);
  const path = join(root,'lessons',filename), html = await readFile(path,'utf8');
  if (html.includes('id="visual-diagrams"')) continue;
  const section = ['  <section id="visual-diagrams">','  <h2>可视化图解</h2>','  <p>模块图说明依赖和数据去向；时序图展示一次代表性调用；分支图列出关键异常与边界。示例链路不代表所有扩展都已默认装配。</p>',...variants.flatMap(([kind,label])=>[
    `  <figure class="course-diagram"><figcaption>${label} · ${title}</figcaption>`,
    `    <a href="../assets/diagrams/${id}-${kind}.svg" target="_blank" rel="noopener"><img src="../assets/diagrams/${id}-${kind}.svg" alt="${title}的${label}图" loading="lazy"></a>`,
    `    <p><a href="../assets/diagrams/${id}-${kind}.svg">打开大图</a> · <a href="../assets/diagrams/${id}-${kind}.mmd">Mermaid 图源</a></p></figure>`]),'  <p><a href="../reference/deepseek-harness-build-roadmap.html#site-architecture">查看全站总体架构</a></p>','  </section>',''];
  const anchor = html.match(/  <h2>本课导览<\/h2>/)?.[0];
  if (!anchor) throw new Error(`缺少课程导览：${filename}`);
  patches.push(`*** Update File: ${path}\n@@\n+${section.join('\n+')}\n ${anchor}`);
}
const [svg,mmd] = overview();
await writeFile(join(directory,'site-architecture.svg'),svg);
await writeFile(join(directory,'site-architecture.mmd'),mmd);
const roadmap = join(root,'reference/deepseek-harness-build-roadmap.html');
if (!(await readFile(roadmap,'utf8')).includes('id="site-architecture"')) {
  const addition = ['  <section id="site-architecture">','  <h2>全站总体架构</h2>','  <p>当前默认链路与独立教学扩展分开标示。工具执行、编排和遥测需要显式装配，不应从课程能力清单推断为全部已接入 Web 宿主。</p>','  <figure class="course-diagram"><figcaption>产品入口、Agent Server、运行时、事实存储与扩展边界</figcaption>','    <a href="../assets/diagrams/site-architecture.svg" target="_blank" rel="noopener"><img src="../assets/diagrams/site-architecture.svg" alt="DeepSeek Harness 实验室全站总体架构图"></a>','    <p><a href="../assets/diagrams/site-architecture.svg">打开大图</a> · <a href="../assets/diagrams/site-architecture.mmd">Mermaid 图源</a></p>','  </figure>','  </section>',''];
  patches.push(`*** Update File: ${roadmap}\n@@\n+${addition.join('\n+')}\n   <h2>路线总表</h2>`);
}
if (process.argv.includes('--embed')) console.log('*** Begin Patch\n'+patches.join('\n')+'\n*** End Patch');
else console.log('已生成 52 张 SVG 和对应 Mermaid 图源。');
