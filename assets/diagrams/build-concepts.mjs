import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { concepts } from './concept-data.mjs';

// 只输出补丁；原始讲解保留，对比紧跟该概念所在正文小节。
const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const chapter = process.argv.find(arg => /^\d{4}$/.test(arg));
const files = (await readdir(join(root, 'lessons'))).filter(name => name.endsWith('.html')).sort();
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const plain = value => value.replace(/<[^>]+>/g, '');
const patches = [];
let covered = 0, total = 0;

// 每个概念都有自己的问题、三个独立实现与差异，不能引用章级表冒充正文对比。
function card(id, index, concept) {
  const names = ['DeepSeek Harness 原实现', 'LangChain DeepAgents', 'OpenHands SDK'];
  return [`  <article class="concept-comparison" id="concept-${id}-${index + 1}" data-concept="${escape(concept.name)}">`,
    `  <h3>${escape(concept.name)}：三框架分别怎么做？</h3>`,
    `  <p><strong>同一个问题：</strong>${escape(concept.question)}</p>`,
    '  <div class="comparison-scroll"><table class="framework-matrix"><thead><tr>' + names.map(name => `<th scope="col">${name}</th>`).join('') + '</tr></thead><tbody><tr>',
    ...concept.entries.map((entry, i) => `    <td data-framework="${['deepseek', 'deepagents', 'openhands'][i]}">${escape(entry.text)} <a href="${escape(entry.source)}">依据</a></td>`),
    '  </tr></tbody></table></div>',
    `  <p><strong>这个概念的区别：</strong>${escape(concept.difference)}</p>`, '  </article>'].join('\n');
}

for (const filename of files) {
  const id = filename.slice(0, 4), path = join(root, 'lessons', filename);
  const original = await readFile(path, 'utf8');
  const checklist = original.split('<h2>完整能力清单</h2>')[1]?.split('</table>')[0];
  const names = [...checklist.matchAll(/<tr><td>(.*?)<\/td>/g)].map(match => plain(match[1]));
  total += names.length;
  const entries = concepts[id] ?? [];
  covered += entries.length;
  if (chapter && id !== chapter || !entries.length) continue;
  if (new Set(entries.map(entry => entry.name)).size !== entries.length) throw new Error(`${id} 有重复概念`);
  for (const entry of entries) {
    if (!names.includes(entry.name)) throw new Error(`${id} 清单中缺少概念：${entry.name}`);
    if (entry.entries.length !== 3 || entry.entries.some(value => !value.text || !value.source)) throw new Error(`${entry.name} 缺少三框架证据`);
  }
  // 去除上次生成块后按原正文标题重新定位，允许幂等更新。
  let html = original.replace(/\n  <!-- 概念内对比：开始 -->[\s\S]*?  <!-- 概念内对比：结束 -->\n/g, '\n');
  // 保留原有清单标题，增加正文概念索引及教学口径说明。
  if (!html.includes('id="concept-index"')) html = html.replace('  <h2>完整能力清单</h2>', '  <p id="concept-index" class="callout">点击下面的概念名称，可直达该概念的三框架实现、区别与依据。原有能力清单、示例和验收描述面向 harness-lab 教学实现；不要将其直接当作上游框架能力声明。</p>\n  <h2>完整能力清单</h2>');
  const headings = [...html.matchAll(/  <h2>([^<]+)<\/h2>/g)];
  for (const heading of [...headings].reverse()) {
    const selected = entries.map((entry, index) => ({ entry, index })).filter(value => value.entry.section === heading[1]);
    if (!selected.length) continue;
    const start = heading.index + heading[0].length;
    const end = html.indexOf('  <h2>', start);
    if (end < 0) throw new Error(`概念小节后缺少边界：${heading[1]}`);
    const addition = '\n  <!-- 概念内对比：开始 -->\n' + selected.map(value => card(id, value.index, value.entry)).join('\n') + '\n  <!-- 概念内对比：结束 -->\n';
    html = html.slice(0, end).trimEnd() + '\n' + addition + '\n' + html.slice(end);
  }
  for (const [index, entry] of entries.entries()) {
    if (!headings.some(heading => heading[1] === entry.section)) throw new Error(`小节不存在：${id}/${entry.section}`);
    // 清单中的名称直接跳到该概念正文，而不是章首摘要。
    const target = `concept-${id}-${index + 1}`;
    if (!html.includes(`<a href="#${target}">`)) html = html.replace(`<tr><td>${entry.name}</td>`, `<tr><td><a href="#${target}">${entry.name}</a></td>`);
  }
  if (html !== original) patches.push(`*** Update File: ${path}\n@@\n${original.trimEnd().split('\n').map(line => '-' + line).join('\n')}\n${html.trimEnd().split('\n').map(line => '+' + line).join('\n')}`);
}
if (process.argv.includes('--embed') && patches.length) console.log('*** Begin Patch\n' + patches.join('\n') + '\n*** End Patch');
else console.log(`正文概念覆盖：${covered}/${total}；待更新页面：${patches.length}。`);
