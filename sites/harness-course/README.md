# Harness 70 节教程静态站

纯静态阅读站，正文仍由浏览器渲染原始 Markdown。构建时打包 70 节课文、补充文档和本地依赖；运行时不需要 Python、Bun、Node 或应用服务器，也不请求第三方 CDN。

## 构建

在本目录执行：

```sh
bun run build
bun run check
```

不需要安装 npm 包。也可以在任意目录执行：

```sh
bun /Users/yhding/ws/github.com/deepseek-harness-demo/sites/harness-course/build.mjs
```

构建脚本兼容 Node 22+，已有 GitHub Pages 工作流使用 `node sites/harness-course/build.mjs`，无需额外安装 Bun。

## 打开与部署

构建后直接打开 `dist/index.html` 即可阅读，无需启动本地服务。HTML 使用经典脚本读取构建生成的 `course-data.js`，避免本地文件模式下的模块和 Markdown 请求限制。

完整上传 `dist/` 到静态文件托管服务即可部署。所有站内资源使用相对路径，支持域名根目录和子目录；课文使用 hash 路由，无需服务器配置路由重写。`harness-course-static.zip` 是可直接解压使用的静态站压缩包，根目录包含 `index.html`。

仓库现有 `scripts/build-pages.mjs` 会先构建本站，再将完整静态产物放入 Pages 输出，入口为 `sites/harness-course/dist/`。现有课程首页会自动出现“70 节连续教程”入口；推送到 GitHub `main` 后，由已有 Pages 工作流构建和发布。

发布后访问：[70 节教程阅读站](https://dddddd889.github.io/deepseek-harness-demo/sites/harness-course/dist/)。[现有课程首页](https://dddddd889.github.io/deepseek-harness-demo/) 同时保留，并提供阅读站入口。

## 更新教材

在 `tutorial/linear` 按既有教材流程更新 `.md` 后，再执行 `bun run build`。网页源码放在 `src/`，第三方浏览器依赖和许可证放在 `public/vendor/`；不要直接修改会被重建的 `dist/`。

构建会保留 Markdown 原始字节，并检查 000～069 编号、教材文件引用、内容 SHA-256、本地依赖摘要与 HTML 静态资源。`bun run check` 只读比较源文件和产物，不改写文件，也不执行教材代码或模型请求。

`dist/content/` 保留可下载的原始 Markdown 与实际引用的证据；`course.json` 提供课程目录；`course-data.js` 提供离线阅读数据。正文内容以 `dist/content/.manifest.json` 中的 SHA-256 为准，仓库提交不代表未提交教材内容的版本。

同步范围包含课程正文、5 份根说明、039 补充问答、历史验收文档和实际引用的附件。`scenarios` 与 `labs` 已合入教材正文，不作为独立页面发布；原版源码链接固定到教材指定的 GitHub 提交。

历史文档 `evidence/node24-history/VERIFICATION.md` 原有一处失效的 `COVERAGE.md` 链接，构建单独记录并保留原文，网页跳转到当前差距清单；其他缺失引用会使构建失败。

## 阅读功能

支持分阶段目录、标题与正文搜索、页内目录、原文切换、代码高亮与复制、Mermaid 图表、前后课导航、深色模式、大字号和手机目录。课次完成需要手动标记，只保存在当前浏览器。

源码提交包含构建脚本、`src/` 与 `public/`。`dist/`、本机交付压缩包和验证截图已忽略，由 CI 从已提交教材重新生成站点。
