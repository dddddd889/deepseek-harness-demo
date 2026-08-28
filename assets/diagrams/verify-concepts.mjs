import { readFile, readdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join, dirname } from 'node:path';
import { concepts } from './concept-data.mjs';

// 默认要求全部覆盖；--partial 只供施工期间检查，不能作为完成证据。
const partial = process.argv.includes('--partial');
const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const failures = [];
const missing = [];
let total = 0;
let covered = 0;
// 与 HTML 展示规则一致，防止标点转义导致错误匹配。
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const plain = value => value.replace(/<[^>]*>/g, '');
// 收集所有错误，一次报告，避免修好首项后才发现下一项。
function check(condition, message) {
  if (!condition) failures.push(message);
}

for (const filename of (await readdir(join(root, 'lessons'))).filter(name => name.endsWith('.html')).sort()) {
  const path = join(root, 'lessons', filename);
  const id = filename.slice(0, 4);
  const html = await readFile(path, 'utf8');
  const checklist = html.split('<h2>完整能力清单</h2>')[1]?.split('</table>')[0] ?? '';
  const names = [...checklist.matchAll(/<tr><td>(.*?)<\/td>/g)].map(match => plain(match[1]));
  const entries = concepts[id] ?? [];
  const articles = [...html.matchAll(/<article class="concept-comparison"[^>]*>[\s\S]*?<\/article>/g)];
  total += names.length;
  check(html.includes('id="concept-index"') && html.includes('href="#concept-index"'), `${id}：缺少正文概念阅读入口`);
  check(names.length > 0, `${id}：缺少能力清单`);
  check(new Set(entries.map(entry => entry.name)).size === entries.length, `${id}：数据中概念重复`);
  check(articles.length === entries.length, `${id}：正文对比数与数据不一致`);
  check(new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1])).size === [...html.matchAll(/\bid="([^"]+)"/g)].length, `${id}：HTML id 重复`);
  for (const name of names) if (!entries.some(entry => entry.name === name)) missing.push(`${id}/${name}`);
  for (const [index, entry] of entries.entries()) {
    const label = `${id}/${entry.name}`;
    const anchor = `concept-${id}-${index + 1}`;
    const matched = articles.filter(article => article[0].includes(`id="${anchor}"`));
    check(names.includes(entry.name), `${label}：不在能力清单`);
    check(matched.length === 1, `${label}：正文目标缺失或重复`);
    check(checklist.includes(`<a href="#${anchor}">${escape(entry.name)}</a>`), `${label}：清单未链接到概念正文`);
    if (matched.length !== 1) continue;
    const article = matched[0];
    const section = [...html.slice(0, article.index).matchAll(/<h2>([^<]+)<\/h2>/g)].at(-1)?.[1];
    check(section === entry.section, `${label}：位于错误的小节 ${section}`);
    check(article.index > html.indexOf('<h2>完整能力清单</h2>'), `${label}：不能用章首汇总代替正文`);
    check(article[0].includes(`data-concept="${escape(entry.name)}"`), `${label}：概念名称不一致`);
    check(Boolean(entry.question?.trim()) && article[0].includes(escape(entry.question)), `${label}：缺少具体问题`);
    check(Boolean(entry.difference?.trim()) && article[0].includes(escape(entry.difference)), `${label}：缺少区别说明`);
    check(entry.entries.length === 3, `${label}：数据不是三个框架`);
    const cells = [...article[0].matchAll(/<td data-framework="([^"]+)">([\s\S]*?)<\/td>/g)];
    check(cells.map(cell => cell[1]).join(',') === 'deepseek,deepagents,openhands', `${label}：框架列缺失或顺序错误`);
    for (const [column, evidence] of entry.entries.entries()) {
      const cell = cells[column]?.[2] ?? '';
      check(Boolean(evidence.text?.trim()) && cell.includes(escape(evidence.text)), `${label}：第 ${column + 1} 列内容缺失或过期`);
      check(cell.includes(`href="${escape(evidence.source)}"`), `${label}：第 ${column + 1} 列依据缺失`);
      if (evidence.source.startsWith('../')) {
        try { await access(resolve(dirname(path), evidence.source.split('#')[0])); }
        catch { failures.push(`${label}：本地依据不存在 ${evidence.source}`); }
      } else {
        try {
          const url = new URL(evidence.source);
          check(url.protocol === 'https:' && ['docs.langchain.com', 'docs.openhands.dev', 'github.com', 'reference.langchain.com'].includes(url.hostname), `${label}：依据不是预期的官方来源`);
        } catch { failures.push(`${label}：依据 URL 无效`); }
      }
    }
    covered++;
  }
}
console.log(`正文概念结构覆盖：${covered}/${total}；未覆盖：${missing.length}。`);
if (missing.length) console.log(`待补：\n${missing.join('\n')}`);
if (failures.length) console.error(failures.join('\n'));
if (failures.length || (!partial && missing.length)) process.exitCode = 1;
else console.log(partial ? '施工检查通过；不代表全部完成或语义审核通过。' : '结构检查通过；来源是否充分支持陈述仍需逐项语义审核。');
