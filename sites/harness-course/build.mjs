import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, relative, resolve, sep, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

// 所有入口按脚本位置定位，构建时不依赖当前终端所在目录。
const siteRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(siteRoot, '../..');
const sourceRoot = resolve(repositoryRoot, 'tutorial/linear');
const outputRoot = resolve(siteRoot, 'dist');
const rootDocuments = ['README.md', 'INDEX.md', 'DEBUGGING.md', 'COVERAGE.md', 'VERIFICATION.md'];
const upstreamBase = 'https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/';
const knownMissingLinks = new Set(['evidence/node24-history/VERIFICATION.md\nCOVERAGE.md']);
const textDecoder = new TextDecoder('utf-8', { fatal: true });

// 固定排序和 JSON 格式，重复构建不引入时间戳或随机字段。
function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

// 文件内容始终按字节比较，中文、换行和代码缩进都不会被构建改写。
function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

// 清单路径统一使用正斜杠，保证不同系统生成同一份站点目录。
function relativePath(root, path) {
  return relative(root, path).split(sep).join('/');
}

// 目录边界按路径片段判断，不能把相似前缀当成合法子目录。
function isWithin(root, path) {
  const value = relative(root, path);
  return value === '' || (value !== '..' && !value.startsWith(`..${sep}`) && !value.startsWith(sep));
}

// 标准文件检查保持只读，符号链接会在收集阶段拒绝，不让它指向额外内容。
async function fileInfo(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

// 递归收集普通文件，静态源码目录中不接受符号链接或设备文件。
async function listFiles(directory) {
  const info = await fileInfo(directory);
  if (!info) return [];
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`不是普通目录：${directory}`);
  const files = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => compareText(a.name, b.name))) {
    const path = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`不允许静态符号链接：${path}`);
    if (entry.isDirectory()) files.push(...await listFiles(path));
    else if (entry.isFile()) files.push(path);
    else throw new Error(`不是普通文件：${path}`);
  }
  return files;
}

// 跳过围栏代码块，避免把代码示例里的标题、数组或括号误认成教材链接。
function proseLines(markdown) {
  const result = [];
  let fenceCharacter = '';
  let fenceLength = 0;
  for (const line of markdown.split(/\r?\n/)) {
    const match = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fenceCharacter) {
      if (match && match[1][0] === fenceCharacter && match[1].length >= fenceLength && !match[2].trim()) fenceCharacter = '';
      continue;
    }
    if (match) {
      fenceCharacter = match[1][0];
      fenceLength = match[1].length;
      continue;
    }
    result.push(line);
  }
  return result;
}

// 解码链接和标题中出现的标准实体，文件路径不会交给 HTML 执行。
function decodeEntities(value) {
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity) => {
    if (entity[0] !== '#') return entities[entity.toLowerCase()] ?? match;
    const number = entity[1].toLowerCase() === 'x' ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
    return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : '\ufffd';
  });
}

// 标题去掉显示标记，保留 finish_reason 这类有实际含义的下划线。
function plainText(value) {
  return decodeEntities(value.replace(/!?\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/<[^>]+>/g, '').replace(/[`*~]/g, '')).trim();
}

// 提取正文标题，和原始 Markdown 一起进入可检查的课程目录。
function headings(markdown) {
  return proseLines(markdown).flatMap((line) => {
    const match = line.match(/^(#{1,6})\s+(.+?)(?:\s+#+\s*)?$/);
    return match ? [{ level: match[1].length, text: plainText(match[2]) }] : [];
  });
}

// 收集正文、引用式 Markdown 及 HTML 中的文件链接，不进入围栏或行内代码。
function markdownLinks(markdown) {
  const prose = proseLines(markdown).join('\n').replace(/(`+).*?\1/g, '');
  const links = [...prose.matchAll(/!?\[[^\]\n]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^\n]*?["'])?\s*\)/g)].map((match) => match[1] || match[2]);
  links.push(...[...prose.matchAll(/^\s{0,3}\[[^\]]+\]:\s*<?([^\s>]+)>?/gm)].map((match) => match[1]));
  links.push(...[...prose.matchAll(/(?:href|src)=["']([^"']+)["']/gi)].map((match) => match[1]));
  return links;
}

// 网页只链接当前提交中已有的练习文件，工作区里尚未提交的文件不能生成线上地址。
async function collectProjectReferences() {
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim();
  const entries = execFileSync('git', ['ls-tree', '-r', '-z', revision, '--', 'harness-own'], { cwd: repositoryRoot, encoding: 'utf8' });
  const tracked = new Set(entries.split('\0').flatMap((entry) => {
    const match = entry.match(/^100(?:644|755) blob [a-f\d]+\t(harness-own\/.+)$/);
    return match ? [match[1]] : [];
  }));
  if (!tracked.size) throw new Error('当前提交没有 harness-own 源码，无法生成可访问的工程链接');
  const settings = JSON.parse(await readFile(resolve(sourceRoot, 'harness-links.json'), 'utf8'));
  if (settings.schemaVersion !== 1 || !settings.aliases || typeof settings.aliases !== 'object') throw new Error('练习文件映射格式不正确');
  for (const [lesson, aliases] of Object.entries(settings.aliases)) {
    if (!/^\d{3}$/.test(lesson) || !aliases || typeof aliases !== 'object') throw new Error('练习文件映射缺少课次');
    for (const [from, to] of Object.entries(aliases)) {
      if (typeof to !== 'string' || !/^[\w./-]+$/.test(from) || !/^[\w./-]+$/.test(to) || posix.normalize(to) !== to || !tracked.has(`harness-own/${to}`)) {
        throw new Error(`练习文件映射目标没有提交：${lesson} · ${from} → ${to}`);
      }
    }
  }
  return { revision, tracked, aliases: settings.aliases, checkedLinks: 0, targets: new Set() };
}

// 相对链接按当前文档解析；原版及同仓练习源码只提供链接，不复制进教材静态正文。
async function localTarget(document, link, project) {
  const value = decodeEntities(link);
  if (/^[a-z][a-z\d+.-]*:|^\/\//i.test(value)) return null;
  const rawPath = decodeURIComponent(value.split(/[?#]/, 1)[0]);
  if (!rawPath) return null;
  if (rawPath.startsWith('/')) throw new Error(`不允许绝对文件路径：${relativePath(sourceRoot, document)} → ${link}`);
  let target = resolve(dirname(document), rawPath);
  if (await fileInfo(target)) target = await realpath(target);
  if (!isWithin(sourceRoot, target)) {
    if (isWithin(resolve(repositoryRoot, 'deepseek-harness'), target)) return null;
    if (isWithin(resolve(repositoryRoot, 'harness-own'), target)) {
      const repositoryPath = relativePath(repositoryRoot, target);
      if (!project.tracked.has(repositoryPath)) throw new Error(`练习源码链接指向未提交或不存在的文件：${relativePath(sourceRoot, document)} → ${link}`);
      if (!(await fileInfo(target))?.isFile()) throw new Error(`同仓练习源码引用不存在：${relativePath(sourceRoot, document)} → ${link}`);
      project.checkedLinks++;
      project.targets.add(repositoryPath);
      return null;
    }
    throw new Error(`链接越出教程目录：${relativePath(sourceRoot, document)} → ${link}`);
  }
  return target;
}

// 从教材成品和根说明出发，沿实际链接收集附件，不执行任何教程代码。
async function collectSourceFiles(project) {
  const lessonFiles = (await listFiles(resolve(sourceRoot, 'lessons'))).filter((path) => extname(path).toLowerCase() === '.md');
  const queue = [...rootDocuments.map((name) => resolve(sourceRoot, name)), ...lessonFiles];
  const files = new Map();
  const warnings = [];
  let checkedLocalLinks = 0;
  for (let index = 0; index < queue.length; index++) {
    const path = await realpath(queue[index]);
    if (!isWithin(sourceRoot, path)) throw new Error(`拒绝复制教程目录以外的文件：${path}`);
    const relative = relativePath(sourceRoot, path);
    if (files.has(relative)) continue;
    const info = await fileInfo(path);
    if (!info?.isFile()) throw new Error(`待同步内容不是普通文件：${relative}`);
    const content = await readFile(path);
    files.set(relative, content);
    if (extname(path).toLowerCase() !== '.md') continue;
    for (const link of markdownLinks(textDecoder.decode(content))) {
      const target = await localTarget(path, link, project);
      if (target === null) continue;
      checkedLocalLinks++;
      const targetInfo = await fileInfo(target);
      if (!targetInfo) {
        if (knownMissingLinks.has(`${relative}\n${link}`)) {
          warnings.push({ document: relative, target: link, reason: '原教材历史链接已失效' });
          continue;
        }
        throw new Error(`教材引用不存在：${relative} → ${link}`);
      }
      if (targetInfo.isDirectory()) {
        const children = await readdir(target, { withFileTypes: true });
        queue.push(...children.filter((child) => child.isFile() && !child.name.startsWith('.')).sort((a, b) => compareText(a.name, b.name)).map((child) => resolve(target, child.name)));
      } else queue.push(target);
    }
  }
  warnings.sort((a, b) => compareText(`${a.document}\n${a.target}`, `${b.document}\n${b.target}`));
  return { files, warnings, checkedLocalLinks };
}

// JSON 正文稳定序列化，原始教材文件仍按字节单独保留。
function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

// 收集页面和本地依赖，依赖哈希不匹配时在写入 dist 前立即停止。
async function collectStaticAssets(expectedFiles) {
  for (const name of ['index.html', 'styles.css', 'app.js']) expectedFiles.set(name, await readFile(resolve(siteRoot, 'src', name)));
  const publicRoot = resolve(siteRoot, 'public');
  for (const path of await listFiles(publicRoot)) {
    const relative = relativePath(publicRoot, path);
    if (relative.split('/').some((part) => part.startsWith('.'))) continue;
    expectedFiles.set(relative, await readFile(path));
  }
  const vendorManifest = JSON.parse(expectedFiles.get('vendor/manifest.json')?.toString('utf8') || 'null');
  if (!Array.isArray(vendorManifest) || vendorManifest.length !== 4) throw new Error('缺少四份固定版本浏览器依赖清单');
  for (const dependency of vendorManifest) {
    if (!/^[\w.-]+\.js$/.test(dependency.file) || !/^[a-f\d]{64}$/.test(dependency.sha256)) throw new Error('浏览器依赖清单格式错误');
    const payload = expectedFiles.get(`vendor/${dependency.file}`);
    if (!payload || sha256(payload) !== dependency.sha256) throw new Error(`浏览器依赖摘要不一致：${dependency.file}`);
    if (!expectedFiles.has(`vendor/${dependency.file}.LICENSE`)) throw new Error(`缺少依赖许可证：${dependency.file}`);
  }
}

// 确认首页只引用构建产物，并以经典脚本读取内嵌课程，支持 file:// 直接打开。
function checkHtmlAssets(expectedFiles) {
  const html = expectedFiles.get('index.html').toString('utf8');
  for (const [, url] of html.matchAll(/(?:href|src|data)=["']([^"']+)["']/g)) {
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(url)) continue;
    const target = posix.normalize(decodeURIComponent(url.split(/[?#]/, 1)[0]));
    if (target.startsWith('../') || target.startsWith('/') || !expectedFiles.has(target)) throw new Error(`首页静态依赖不存在：${url}`);
  }
  const scripts = [...html.matchAll(/<script\b([^>]*)>[\s\S]*?<\/script>/gi)].map((match) => match[1]);
  const dataIndex = scripts.findIndex((attributes) => /\bsrc=["']course-data\.js["']/i.test(attributes));
  const appIndex = scripts.findIndex((attributes) => /\bsrc=["']app\.js["']/i.test(attributes));
  if (dataIndex < 0 || appIndex <= dataIndex) throw new Error('首页必须先读取 course-data.js，再读取 app.js');
  if (scripts.some((attributes) => /\btype=["']module["']/i.test(attributes))) throw new Error('直接打开的静态站不能依赖 module 脚本');
}

// 先完整收集并验证源文件，之后才允许写入生成目录。
async function generate() {
  const project = await collectProjectReferences();
  const { files, warnings, checkedLocalLinks } = await collectSourceFiles(project);
  const ids = Array.from({ length: 70 }, (_, index) => String(index).padStart(3, '0'));
  const metadata = JSON.parse(await readFile(resolve(sourceRoot, 'lessons.json'), 'utf8'));
  if (JSON.stringify(metadata.map((lesson) => lesson.id)) !== JSON.stringify(ids)) throw new Error('lessons.json 必须按顺序包含且仅包含 000～069 共 70 课');
  const chapterPaths = ids.map((id) => `lessons/${id}.md`);
  const actualPaths = [...files.keys()].filter((path) => /^lessons\/\d{3}\.md$/.test(path)).sort(compareText);
  if (JSON.stringify(actualPaths) !== JSON.stringify(chapterPaths)) throw new Error('正文编号不连续，必须完整包含 lessons/000.md～069.md');
  const chapters = metadata.map((lesson) => {
    const path = `lessons/${lesson.id}.md`;
    const markdown = textDecoder.decode(files.get(path));
    return { id: lesson.id, title: lesson.title, phase: lesson.phase, path, headings: headings(markdown), text: markdown };
  });
  const documents = [...files.keys()].filter((path) => path.endsWith('.md') && !chapterPaths.includes(path)).sort((left, right) => {
    const leftIndex = rootDocuments.indexOf(left);
    const rightIndex = rootDocuments.indexOf(right);
    return (leftIndex < 0 ? rootDocuments.length : leftIndex) - (rightIndex < 0 ? rootDocuments.length : rightIndex) || compareText(left, right);
  }).map((path) => {
    const documentHeadings = headings(textDecoder.decode(files.get(path)));
    return { path, title: documentHeadings[0]?.text || posix.basename(path, '.md') };
  });
  const revision = project.revision;
  const course = {
    title: '从空工程逐步实现 Harness',
    description: '70 节连续教程：从命令行入口开始，逐步接通模型、工具、会话、Web 与 Electron。',
    sourceRevision: revision, upstreamBase, chapters, documents,
    projectFiles: [...project.tracked].map((path) => path.slice('harness-own/'.length)).sort(compareText),
    projectAliases: project.aliases,
  };
  const manifest = {
    schemaVersion: 1, sourceRoot: 'tutorial/linear', sourceRevision: revision,
    chapterCount: chapters.length, documentCount: documents.length, checkedLocalLinks,
    checkedProjectLinks: project.checkedLinks, projectLinkTargets: [...project.targets].sort(compareText),
    files: [...files].sort(([left], [right]) => compareText(left, right)).map(([path, content]) => ({ path, bytes: content.length, sha256: sha256(content) })),
    warnings,
  };
  const expectedFiles = new Map([...files].map(([path, content]) => [`content/${path}`, content]));
  expectedFiles.set('content/.manifest.json', jsonBytes(manifest));
  expectedFiles.set('course.json', jsonBytes(course));
  const bundledCourse = { ...course, documents: documents.map((document) => ({ ...document, text: textDecoder.decode(files.get(document.path)) })) };
  const scriptData = JSON.stringify(bundledCourse).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  expectedFiles.set('course-data.js', Buffer.from(`// 构建时内嵌原始 Markdown，浏览器阅读不请求后台或本地服务。\nwindow.HARNESS_COURSE_DATA = ${scriptData};\n`));
  await collectStaticAssets(expectedFiles);
  checkHtmlAssets(expectedFiles);
  return { expectedFiles, files, course, manifest };
}

// 只读比较每一个生成文件，并拒绝目录中残留未登记的旧产物。
async function checkOutput(expectedFiles) {
  const failures = [];
  for (const [path, expected] of expectedFiles) {
    const actualPath = resolve(outputRoot, path);
    const info = await fileInfo(actualPath);
    if (!info?.isFile() || info.isSymbolicLink() || sha256(await readFile(actualPath)) !== sha256(expected)) failures.push(`产物未更新或内容摘要不一致：${path}`);
  }
  for (const path of await listFiles(outputRoot)) {
    const relative = relativePath(outputRoot, path);
    if (!expectedFiles.has(relative)) failures.push(`存在未登记的旧产物：${relative}`);
  }
  if (failures.length) throw new Error(failures.slice(0, 20).join('\n'));
}

// dist 是唯一清理和重建的目录，教材、页面源码和本地依赖完全不受影响。
async function writeOutput(expectedFiles) {
  const info = await fileInfo(outputRoot);
  if (info?.isSymbolicLink() || (info && !info.isDirectory())) throw new Error('dist 必须是本站普通生成目录');
  await rm(outputRoot, { recursive: true, force: true });
  for (const [path, content] of expectedFiles) {
    const destination = resolve(outputRoot, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, content);
  }
  await checkOutput(expectedFiles);
}

// CLI 同时兼容 Bun 和 Node 22，构建与检查都不下载依赖或调用 Python。
async function main() {
  const arguments_ = process.argv.slice(2);
  if (arguments_.some((argument) => !['--check', '--help', '-h'].includes(argument))) throw new Error('仅支持 --check 或 --help 参数');
  if (arguments_.includes('--help') || arguments_.includes('-h')) {
    console.log('用法：bun build.mjs [--check]\n构建：生成可直接打开、可静态托管的 dist。\n--check：只读校验产物、课程内容、依赖摘要及首页引用。');
    return;
  }
  const { expectedFiles, files, course, manifest } = await generate();
  if (arguments_.includes('--check')) await checkOutput(expectedFiles);
  else await writeOutput(expectedFiles);
  const operation = arguments_.includes('--check') ? '只读校验通过' : '静态站构建并校验通过';
  console.log(`${operation}：70 课，${course.documents.length} 份补充文档，${files.size} 个原样内容文件，${expectedFiles.size} 个静态产物。`);
  console.log(`教材正文 ${[...files.values()].reduce((total, content) => total + content.length, 0).toLocaleString('en-US')} 字节；已检查 ${manifest.checkedLocalLinks} 处教材内部引用。`);
  console.log(`已核对 ${manifest.checkedProjectLinks} 处 harness-own 链接，覆盖 ${manifest.projectLinkTargets.length} 个已提交文件。`);
  console.log('输出：sites/harness-course/dist/index.html；阅读和部署均不需要 Python 或后台进程。');
  for (const warning of manifest.warnings) console.log(`历史资料提示：${warning.document} → ${warning.target}（${warning.reason}）`);
}

main().catch((error) => {
  console.error(`构建校验失败：${error.message}`);
  process.exitCode = 1;
});
