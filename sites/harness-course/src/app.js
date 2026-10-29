// 教材以原始 Markdown 为唯一正文来源；构建时打包原文，浏览器负责渲染和本地学习记录。
const $ = (id) => document.getElementById(id);
const contentRoot = new URL('./content/', window.location.href);
const storageKey = 'harness-course:reading:v1';
const phaseNames = {
  R00: '从空工程开始', R01: '插件与服务', R02: '会话与持久化',
  R03: '模型与工具循环', R04: '本地能力与权限', R05: '扩展能力与 Host',
  R06: 'SDK 与远程协议', R07: 'Web 阅读与操作', R08: 'Electron 桌面端', R09: '整合与最终验收',
};
// 页面状态与学习状态分开保存，切换课文不会改变用户已经标记的完成记录。
let course;
let currentPath = '';
let currentMarkdown = '';
let currentHeadings = [];
let loadSequence = 0;
let diagramSequence = 0;
let diagramQueue = Promise.resolve();
let diagramObserver;
let headingObserver;
let rawMode = false;
let searchTimer;
const markdownCache = new Map();
let reading = readStorage();

// 隐私模式或禁用本地存储时，仍然允许阅读，只在当前页面内保存进度。
function readStorage() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
    return { completed: Array.isArray(saved.completed) ? saved.completed.filter((id) => /^\d{3}$/.test(id)) : [],
      last: typeof saved.last === 'string' ? saved.last : '',
      theme: saved.theme === 'dark' ? 'dark' : 'light', font: saved.font === 'large' ? 'large' : 'normal' };
  } catch { return { completed: [], last: '', theme: 'light', font: 'normal' }; }
}

// 本地记录只包含阅读位置、完成课次和显示偏好，不上传到服务器。
function saveStorage() {
  try { localStorage.setItem(storageKey, JSON.stringify(reading)); } catch { /* 存储不可用不阻断阅读。 */ }
}

// 用文本节点插入动态标题，避免把搜索词或教材标题解释成 HTML。
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// URL 使用 hash 路由，静态托管无需配置服务器重写。
function routeUrl(path, heading = '') {
  return `#/${path}${heading ? `#${encodeURIComponent(heading)}` : ''}`;
}

// 校验路径后才读取已打包的原文，页面仅能访问课程清单中登记的 Markdown。
function readRoute() {
  const value = window.location.hash.replace(/^#\/?/, '') || 'README.md';
  const separator = value.indexOf('#');
  let path = separator < 0 ? value : value.slice(0, separator);
  let heading = separator < 0 ? '' : value.slice(separator + 1);
  try { path = decodeURIComponent(path); heading = decodeURIComponent(heading); } catch { /* 保留原值供错误页显示。 */ }
  return { path, heading };
}

// 标题锚点保留中文，兼容教材已有的 GitHub 风格页内链接。
function headingSlug(text, used) {
  const base = text.trim().toLowerCase().replace(/[^\p{L}\p{N}_\-\s]/gu, '').replace(/\s/g, '-');
  const count = used.get(base) || 0;
  used.set(base, count + 1);
  return count ? `${base}-${count}` : base;
}

// 目录按既有 R00～R09 阶段分组，目录编号沿用教材的 000～069。
function renderCourseList() {
  const fragment = document.createDocumentFragment();
  for (const [phase, name] of Object.entries(phaseNames)) {
    const chapters = course.chapters.filter((chapter) => chapter.phase === phase);
    if (!chapters.length) continue;
    const group = element('details', 'stage-group');
    group.open = true;
    const summary = element('summary', '', `${phase} · ${name}`);
    group.append(summary);
    const list = element('div', 'stage-lessons');
    for (const chapter of chapters) {
      const link = element('a', 'lesson-link');
      link.href = routeUrl(chapter.path);
      link.dataset.lesson = chapter.id;
      link.dataset.path = chapter.path;
      link.append(element('span', 'lesson-number', chapter.id), element('span', 'lesson-title', chapter.title));
      const status = element('span', 'lesson-status', '');
      status.setAttribute('aria-hidden', 'true');
      link.append(status);
      list.append(link);
    }
    group.append(list);
    fragment.append(group);
  }
  $('course-list').replaceChildren(fragment);
  updateProgress();
}

// 完成只由用户主动标记；打开某一课不会自动算作学会。
function updateProgress() {
  const completed = new Set(reading.completed);
  const count = course.chapters.filter((chapter) => completed.has(chapter.id)).length;
  $('progress-count').textContent = `${count} / ${course.chapters.length}`;
  $('progress-fill').style.width = `${count / course.chapters.length * 100}%`;
  for (const link of document.querySelectorAll('.lesson-link')) {
    const done = completed.has(link.dataset.lesson);
    const active = link.dataset.path === currentPath;
    link.classList.toggle('is-complete', done);
    link.classList.toggle('is-active', active);
    if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    link.querySelector('.lesson-status').textContent = done ? '✓' : '';
  }
  const chapter = course.chapters.find((item) => item.path === currentPath);
  $('complete-button').hidden = !chapter;
  const done = chapter && completed.has(chapter.id);
  $('complete-button').textContent = done ? '✓ 已完成，点击撤销' : '标记本课完成';
  $('complete-button').setAttribute('aria-pressed', String(Boolean(done)));
  const last = course.chapters.find((item) => item.path === reading.last) || course.chapters[0];
  $('continue-link').href = routeUrl(last.path);
  $('continue-link').textContent = `继续学习 · ${last.id}`;
}

// 将课文链接定位到站内原始文件；原版源码固定到教材指定的提交。
function rewriteLinks(container, path) {
  const base = new URL(path, contentRoot);
  for (const link of container.querySelectorAll('a[href]')) {
    const href = link.getAttribute('href');
    if (!href) continue;
    if (href.startsWith('#')) { link.href = routeUrl(path, href.slice(1)); continue; }
    if (/^[a-z][a-z\d+.-]*:|^\/\//i.test(href)) {
      if (/^https?:/i.test(href)) { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
      continue;
    }
    const resolved = new URL(href, base);
    if (resolved.pathname.startsWith(contentRoot.pathname)) {
      let target = decodeURIComponent(resolved.pathname.slice(contentRoot.pathname.length));
      // 历史验收记录有一个既有失效相对链接，阅读时指向当前差距清单。
      if (target === 'evidence/node24-history/COVERAGE.md') target = 'COVERAGE.md';
      if (target.endsWith('.md')) link.href = routeUrl(target, decodeURIComponent(resolved.hash.slice(1)));
      else { link.href = resolved.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; }
      continue;
    }
    const repositoryPath = new URL(href, `https://course.invalid/tutorial/linear/${path}`).pathname.slice(1);
    if (repositoryPath.startsWith('deepseek-harness/')) {
      link.href = `${course.upstreamBase}${repositoryPath.slice('deepseek-harness/'.length)}${resolved.hash}`;
    } else {
      link.href = `https://github.com/dddddd889/deepseek-harness-demo/blob/${course.sourceRevision}/${repositoryPath}${resolved.hash}`;
    }
    link.target = '_blank'; link.rel = 'noopener noreferrer';
  }
  for (const image of container.querySelectorAll('img[src]')) image.src = new URL(image.getAttribute('src'), base).href;
}

// 复制以教材原文为准，代码高亮和显示换行不会改写复制结果。
async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    const previous = button.textContent;
    button.textContent = '已复制';
    setTimeout(() => { if (button.isConnected) button.textContent = previous; }, 1600);
  } catch { button.textContent = '复制失败，请选中复制'; }
}

// 代码块独立横向滚动，避免长源码把整张页面撑宽。
function decorateCode(container, sequence) {
  const languages = { sh: 'bash', js: 'javascript', ts: 'typescript', dotenv: 'plaintext', text: 'plaintext', mjs: 'javascript' };
  for (const code of container.querySelectorAll('pre > code')) {
    const source = code.textContent;
    const language = [...code.classList].find((name) => name.startsWith('language-'))?.slice(9) || 'text';
    const pre = code.parentElement;
    if (language === 'mermaid') { createDiagram(pre, source, sequence); continue; }
    const wrapper = element('div', 'code-block');
    const toolbar = element('div', 'toolbar');
    const copy = element('button', 'copy-button', '复制');
    copy.type = 'button'; copy.setAttribute('aria-label', '复制本段代码');
    copy.addEventListener('click', () => copyText(source, copy));
    toolbar.append(element('span', 'code-language', language), copy);
    pre.replaceWith(wrapper); wrapper.append(toolbar, pre);
    const normalized = languages[language] || language;
    if (window.hljs?.getLanguage(normalized)) {
      code.innerHTML = window.hljs.highlight(source, { language: normalized, ignoreIllegals: true }).value;
      code.classList.add('hljs');
    }
  }
}

// 图表进入阅读区域时才渲染，长课文不必一次等待所有时序图。
function createDiagram(pre, source, sequence) {
  const wrapper = element('section', 'diagram');
  const toolbar = element('div', 'toolbar');
  const copy = element('button', 'copy-button', '复制图源码');
  copy.type = 'button'; copy.addEventListener('click', () => copyText(source, copy));
  toolbar.append(element('span', 'code-language', 'MERMAID · 时序与流程'), copy);
  const canvas = element('div', 'diagram-canvas', '图表加载中…');
  const details = element('details', 'diagram-source');
  details.append(element('summary', '', '查看图表源码'));
  const raw = element('pre', ''); raw.append(element('code', '', source)); details.append(raw);
  wrapper.append(toolbar, canvas, details); pre.replaceWith(wrapper);
  const render = () => {
    diagramQueue = diagramQueue.then(async () => {
      if (sequence !== loadSequence || !canvas.isConnected) return;
      try {
        if (!window.mermaid) throw new Error('图表依赖未加载');
        const { svg, bindFunctions } = await window.mermaid.render(`diagram-${++diagramSequence}`, source);
        if (sequence !== loadSequence || !canvas.isConnected) return;
        canvas.innerHTML = svg;
        bindFunctions?.(canvas);
        canvas.dataset.rendered = 'true';
      } catch (error) {
        canvas.textContent = `图表暂时无法渲染，可以展开下方源码。${error.message || ''}`;
        canvas.classList.add('diagram-error');
        details.open = true;
      }
    });
  };
  if ('IntersectionObserver' in window) { canvas.renderDiagram = render; diagramObserver.observe(canvas); }
  else render();
}

// 右侧目录直接取自渲染后的标题，保证显示文字和跳转目标一致。
function renderToc() {
  const used = new Map();
  currentHeadings = [...$('markdown-content').querySelectorAll('h1,h2,h3,h4')];
  const fragment = document.createDocumentFragment();
  for (const heading of currentHeadings) {
    heading.id = headingSlug(heading.textContent, used);
    if (heading.tagName === 'H1') continue;
    const link = element('a', `toc-link toc-${heading.tagName.toLowerCase()}`, heading.textContent);
    link.href = routeUrl(currentPath, heading.id);
    link.dataset.heading = heading.id;
    fragment.append(link);
  }
  $('toc').replaceChildren(fragment);
  $('toc-panel').hidden = currentHeadings.length < 2;
  headingObserver?.disconnect();
  if ('IntersectionObserver' in window) {
    headingObserver = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (!visible) return;
      for (const link of $('toc').querySelectorAll('.toc-link')) link.classList.toggle('is-active', link.dataset.heading === visible.target.id);
    }, { rootMargin: '-90px 0px -65% 0px' });
    currentHeadings.forEach((heading) => headingObserver.observe(heading));
  }
}

// 上下课始终按原教程的累计顺序推进，不根据搜索结果改变顺序。
function renderNavigation(chapter) {
  const index = course.chapters.indexOf(chapter);
  const previous = index > 0 ? course.chapters[index - 1] : null;
  const next = index >= 0 ? course.chapters[index + 1] : course.chapters[0];
  $('previous-link').hidden = !previous;
  $('next-link').hidden = !next;
  if (previous) {
    $('previous-link').href = routeUrl(previous.path);
    $('previous-link').replaceChildren(element('span', 'nav-direction', '← 上一节'), element('strong', '', `${previous.id} · ${previous.title}`));
  }
  if (next) {
    $('next-link').href = routeUrl(next.path);
    $('next-link').replaceChildren(element('span', 'nav-direction', '下一节 →'), element('strong', '', `${next.id} · ${next.title}`));
  }
}

// 同一课内跳转目录不会重新渲染正文；切课时让较早提交的图表渲染失效。
async function loadPage() {
  const route = readRoute();
  closeSidebar();
  if (route.path === currentPath && currentMarkdown) { scrollToHeading(route.heading); return; }
  const sequence = ++loadSequence;
  const allowed = [...course.chapters, ...course.documents].some((document) => document.path === route.path);
  if (!allowed) { showError('这份文档不在课程清单中。请从左侧目录重新进入。'); return; }
  // 切课前清除已显示状态，避免生成中的图表与新正文混用。
  currentPath = ''; currentMarkdown = '';
  $('notice').hidden = true;
  $('raw-toggle').disabled = true;
  if (rawMode) $('raw-code').textContent = '正在读取 Markdown…';
  $('markdown-content').setAttribute('aria-busy', 'true');
  $('markdown-content').replaceChildren(element('p', 'loading', '正在读取 Markdown…'));
  diagramObserver?.disconnect();
  try {
    const markdown = markdownCache.get(route.path);
    if (markdown === undefined) throw new Error('构建产物缺少这份 Markdown，请重新执行 bun run build。');
    if (sequence !== loadSequence) return;
    currentPath = route.path; currentMarkdown = markdown;
    $('raw-toggle').disabled = false;
    $('source-link').hidden = false;
    $('lesson-navigation').hidden = false;
    const chapter = course.chapters.find((item) => item.path === currentPath);
    const documentInfo = course.documents.find((item) => item.path === currentPath);
    const title = chapter?.title || documentInfo?.title || currentPath;
    document.title = `${chapter ? `${chapter.id} · ` : ''}${title} · 从零实现 Harness`;
    $('breadcrumb').textContent = chapter ? `${chapter.phase} · ${phaseNames[chapter.phase] || chapter.phase}` : '课程资料';
    $('chapter-meta').textContent = chapter ? `第 ${Number(chapter.id) + 1} / ${course.chapters.length} 节 · 编号 ${chapter.id} · 约 ${Math.max(1, Math.ceil(markdown.length / 1300))} 分钟阅读` : '学习指南 · Markdown 原文渲染';
    $('source-link').href = new URL(currentPath, contentRoot).href;
    $('source-link').download = currentPath.split('/').pop();
    $('raw-code').textContent = markdown;
    const html = window.marked.parse(markdown, { gfm: true, breaks: false });
    $('markdown-content').innerHTML = window.DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
    rewriteLinks($('markdown-content'), currentPath);
    if ('IntersectionObserver' in window) {
      diagramObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) if (entry.isIntersecting) { diagramObserver.unobserve(entry.target); entry.target.renderDiagram(); }
      }, { rootMargin: '500px' });
    }
    decorateCode($('markdown-content'), sequence);
    renderToc(); renderNavigation(chapter);
    if (chapter) { reading.last = chapter.path; saveStorage(); }
    updateProgress(); setRawMode(rawMode);
    $('markdown-content').removeAttribute('aria-busy');
    // 图表在上方插入后可能改变高度，锚点先定位，渲染完成后再校正一次。
    scrollToHeading(route.heading);
    if (route.heading) diagramQueue.then(() => { if (sequence === loadSequence) scrollToHeading(route.heading); });
  } catch (error) { if (sequence === loadSequence) showError(`无法打开这份课文：${error.message}`); }
}

// 页面加载失败提供可操作的返回入口，不展示空白正文。
function showError(message) {
  currentPath = ''; currentMarkdown = '';
  currentHeadings = [];
  diagramObserver?.disconnect(); headingObserver?.disconnect();
  $('raw-code').textContent = '';
  $('toc').replaceChildren(); $('toc-panel').hidden = true;
  $('raw-toggle').disabled = true;
  $('source-link').hidden = true;
  $('lesson-navigation').hidden = true;
  $('complete-button').hidden = true;
  $('notice').hidden = false; $('notice').textContent = message;
  $('markdown-content').removeAttribute('aria-busy');
  const link = element('a', '', '返回教程说明'); link.href = routeUrl('README.md');
  $('markdown-content').replaceChildren(element('h1', '', '暂时无法打开'), link);
  $('raw-content').hidden = true; $('markdown-content').hidden = false;
}

// 原文模式保持完整 Markdown，便于核对围栏与复制整篇内容。
function setRawMode(enabled) {
  rawMode = enabled;
  $('raw-content').hidden = !enabled; $('markdown-content').hidden = enabled;
  $('raw-toggle').setAttribute('aria-pressed', String(enabled));
  $('raw-toggle').textContent = enabled ? '阅读视图' : 'Markdown 原文';
  $('toc-panel').classList.toggle('is-raw', enabled);
}

// 以当前路由的标题锚点为目标；浏览器后退能回到上一课和上一段。
function scrollToHeading(id) {
  if (!id) { window.scrollTo({ top: 0, behavior: 'instant' }); return; }
  // 补充问答还使用 <a id="q1"> 这样的显式锚点，查找范围限制在已渲染正文。
  const target = [...$('markdown-content').querySelectorAll('[id]')].find((node) => node.id === id);
  if (target) {
    // 原文的问答可能收在 details 中，跳转时先展开祖先，确保目标实际可见。
    for (let parent = target.parentElement; parent && $('markdown-content').contains(parent); parent = parent.parentElement) {
      if (parent.tagName === 'DETAILS') parent.open = true;
    }
    const visibleTarget = target.tagName === 'A' && !target.textContent && target.nextElementSibling ? target.nextElementSibling : target;
    visibleTarget.scrollIntoView({ block: 'start', behavior: 'instant' });
  }
}

// 全文搜索在本机完成，编号、标题和正文均可命中，不请求外部搜索服务。
function renderSearch() {
  const query = $('search-input').value.trim();
  $('search-clear').hidden = !query;
  $('course-list').hidden = Boolean(query); $('search-results').hidden = !query;
  if (!query) { $('search-results').replaceChildren(); return; }
  const terms = query.toLocaleLowerCase().split(/\s+/);
  const matches = course.chapters.map((chapter) => {
    const title = `${chapter.id} ${chapter.title}`.toLocaleLowerCase();
    const body = chapter.text.toLocaleLowerCase();
    const score = terms.reduce((value, term) => value + (title.includes(term) ? 10 : body.includes(term) ? 1 : 0), 0);
    return { chapter, score, matches: terms.every((term) => title.includes(term) || body.includes(term)) };
  }).filter((item) => item.matches).sort((a, b) => b.score - a.score || a.chapter.id.localeCompare(b.chapter.id));
  const fragment = document.createDocumentFragment();
  fragment.append(element('p', 'search-count', `找到 ${matches.length} 节相关课程`));
  for (const { chapter } of matches) {
    const link = element('a', 'search-result'); link.href = routeUrl(chapter.path);
    link.append(element('strong', '', `${chapter.id} · ${chapter.title}`));
    const index = Math.max(0, chapter.text.toLocaleLowerCase().indexOf(terms[0]));
    const snippet = chapter.text.slice(Math.max(0, index - 25), index + 110).replace(/\s+/g, ' ');
    link.append(element('span', '', `${index > 25 ? '…' : ''}${snippet}…`)); fragment.append(link);
  }
  if (!matches.length) fragment.append(element('p', 'search-empty', '换一个关键词试试，例如“持久化”“MCP”或“041”。'));
  $('search-results').replaceChildren(fragment);
}

// 手机目录打开时同步按钮状态；点击遮罩或按 Escape 即可返回正文。
function closeSidebar() { document.body.classList.remove('sidebar-open'); $('menu-toggle').setAttribute('aria-expanded', 'false'); }

// 阅读进度只表示当前文章滚动位置，和手动标记的课程完成进度分开。
function updateReadingProgress() {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  $('reading-progress').style.width = `${max > 0 ? Math.min(100, window.scrollY / max * 100) : 0}%`;
}

// 所有页面交互统一装配一次，后续切课不重复注册监听器。
function bindControls() {
  document.querySelector('.skip-link').addEventListener('click', (event) => {
    event.preventDefault(); $('markdown-content').focus(); $('markdown-content').scrollIntoView();
  });
  $('menu-toggle').addEventListener('click', () => {
    const open = document.body.classList.toggle('sidebar-open'); $('menu-toggle').setAttribute('aria-expanded', String(open));
  });
  $('sidebar-overlay').addEventListener('click', closeSidebar);
  $('raw-toggle').addEventListener('click', () => setRawMode(!rawMode));
  $('theme-toggle').addEventListener('click', () => {
    reading.theme = reading.theme === 'dark' ? 'light' : 'dark'; applyPreferences(); saveStorage();
  });
  $('font-toggle').addEventListener('click', () => {
    reading.font = reading.font === 'large' ? 'normal' : 'large'; applyPreferences(); saveStorage();
  });
  $('complete-button').addEventListener('click', () => {
    const chapter = course.chapters.find((item) => item.path === currentPath); if (!chapter) return;
    reading.completed = reading.completed.includes(chapter.id) ? reading.completed.filter((id) => id !== chapter.id) : [...reading.completed, chapter.id];
    saveStorage(); updateProgress();
  });
  $('search-input').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(renderSearch, 130); });
  $('search-clear').addEventListener('click', () => { $('search-input').value = ''; renderSearch(); $('search-input').focus(); });
  document.addEventListener('keydown', (event) => {
    if (event.key === '/' && !['INPUT', 'TEXTAREA'].includes(event.target.tagName) && !event.target.isContentEditable) {
      event.preventDefault(); document.body.classList.add('sidebar-open'); $('menu-toggle').setAttribute('aria-expanded', 'true'); $('search-input').focus();
    }
    if (event.key === 'Escape') { closeSidebar(); $('search-input').blur(); }
  });
  window.addEventListener('hashchange', loadPage);
  window.addEventListener('scroll', updateReadingProgress, { passive: true });
  window.addEventListener('resize', updateReadingProgress, { passive: true });
}

// 显示偏好写在 body 上，CSS 同时处理正文、目录和代码的配色。
function applyPreferences() {
  document.body.dataset.theme = reading.theme; document.body.dataset.font = reading.font;
  $('theme-toggle').setAttribute('aria-pressed', String(reading.theme === 'dark'));
  $('theme-toggle').setAttribute('aria-label', reading.theme === 'dark' ? '切换浅色模式' : '切换深色模式');
  $('theme-toggle').title = reading.theme === 'dark' ? '切换浅色模式' : '切换深色模式';
  $('font-toggle').setAttribute('aria-pressed', String(reading.font === 'large'));
  $('font-toggle').setAttribute('aria-label', reading.font === 'large' ? '恢复正文字号' : '放大正文字号');
}

// 原文由构建生成的经典脚本提供，不发起 fetch，双击 index.html 也能完整阅读。
async function boot() {
  applyPreferences();
  try {
    if (!window.marked || !window.DOMPurify) throw new Error('Markdown 依赖缺失，请检查 vendor 目录。');
    window.mermaid?.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true,
      theme: 'neutral', fontFamily: 'system-ui, sans-serif', sequence: { useMaxWidth: false, wrap: true }, flowchart: { htmlLabels: false } });
    course = window.HARNESS_COURSE_DATA;
    if (!course || !Array.isArray(course.chapters) || !Array.isArray(course.documents)) {
      throw new Error('课程数据缺失，请重新执行 bun run build。');
    }
    for (const entry of [...course.chapters, ...course.documents]) {
      if (typeof entry.text !== 'string') throw new Error(`构建产物缺少原文：${entry.path}`);
      markdownCache.set(entry.path, entry.text);
    }
    renderCourseList(); bindControls(); await loadPage();
  } catch (error) { showError(error.message); }
}

boot();
