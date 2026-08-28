import { readdir, readFile, mkdir, writeFile, copyFile, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, relative, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

// 只发布明确允许的静态资源；输出目录必须是新目录，避免覆盖已有文件。
const root = fileURLToPath(new URL('../', import.meta.url));
const output = process.argv[2] && resolve(process.argv[2]);
const repository = process.env.GITHUB_REPOSITORY;
if (!output || !/^[\w.-]+\/[\w.-]+$/.test(repository ?? '')) throw new Error('请指定新输出目录，并设置 GITHUB_REPOSITORY=组织/仓库。');
await mkdir(output);
const revision = process.env.GITHUB_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const extensions = new Set(['.html', '.css', '.svg', '.mmd', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.woff', '.woff2']);
const published = new Set();
const pages = [];

// 子模块链接固定到仓库记录的提交，不要求 CI 检出子模块。
const upstream = new Map();
for (const [directory, repo] of [['deepseek-harness', 'deepseek-ai/deepseek-harness'], ['cordis', 'cordiverse/cordis']]) {
  const entry = execFileSync('git', ['ls-tree', 'HEAD', directory], { cwd: root, encoding: 'utf8' });
  const commit = entry.match(/^160000 commit ([a-f0-9]+)\t/);
  if (!commit) throw new Error(`缺少子模块版本：${directory}`);
  upstream.set(directory, `https://github.com/${repo}/blob/${commit[1]}/`);
}

// 将站外源码引用改为 GitHub 地址，保留站内相对路径以兼容项目型 Pages 子路径。
function rewrite(html, path) {
  return html.replace(/href="([^"#]+)(#[^"]*)?"/g, (match, href, fragment = '') => {
    if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(href)) return match;
    const target = relative(root, resolve(root, dirname(path), decodeURIComponent(href))).replaceAll('\\', '/');
    if (target.startsWith('../')) throw new Error(`链接越出仓库：${path} → ${href}`);
    const [first, ...rest] = target.split('/');
    if (upstream.has(first)) return `href="${upstream.get(first)}${rest.map(encodeURIComponent).join('/')}${fragment}"`;
    if (first === 'harness-lab' || first === '.vscode' || extname(target) === '.md') return `href="https://github.com/${repository}/blob/${revision}/${target.split('/').map(encodeURIComponent).join('/')}${fragment}"`;
    return match;
  });
}

// 递归处理站点目录，不跟随符号链接，也不复制构建脚本和测试工具。
async function publish(directory) {
  for (const entry of await readdir(resolve(root, directory), { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error(`不允许发布符号链接：${path}`);
    if (entry.isDirectory()) { await publish(path); continue; }
    if (!extensions.has(extname(path))) continue;
    await mkdir(dirname(resolve(output, path)), { recursive: true });
    if (extname(path) === '.html') {
      const html = rewrite(await readFile(resolve(root, path), 'utf8'), path);
      await writeFile(resolve(output, path), html);
      pages.push([path, html]);
    } else await copyFile(resolve(root, path), resolve(output, path));
    published.add(path);
  }
}
for (const directory of ['assets', 'lessons', 'reference']) await publish(directory);

// 根路径跳转到课程路线图；相对地址兼容用户名站点和仓库子路径。
await writeFile(resolve(output, 'index.html'), '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="0;url=reference/deepseek-harness-build-roadmap.html"><title>DeepSeek Harness 课程</title></head><body><a href="reference/deepseek-harness-build-roadmap.html">进入课程路线图</a></body></html>\n');
await writeFile(resolve(output, '.nojekyll'), '');

// 检查部署产物中的链接和嵌入资源，包含交互 SVG 的 object data 属性。
for (const [path, html] of pages) {
  for (const [, url] of html.matchAll(/(?:href|src|data)="([^"]+)"/g)) {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(url)) continue;
    const target = resolve(output, dirname(path), decodeURIComponent(url.split(/[?#]/)[0]));
    if (!target.startsWith(output + '/')) throw new Error(`链接越出发布目录：${url}`);
    if (!(await stat(target).catch(() => null))?.isFile()) throw new Error(`发布链接缺失：${path} → ${url}`);
  }
}
console.log(`站点构建成功：${pages.length} 个页面，${published.size} 个静态文件；本地资源链接全部通过。`);
