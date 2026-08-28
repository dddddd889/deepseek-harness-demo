# 发布课程站点

1. 将仓库（包含 `assets/diagrams/` 的 SVG、图源和交互样式）推送到 GitHub 的 `main` 分支。
2. 在 GitHub 仓库的 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。
3. 后续推送 `main` 自动部署；也可在 **Actions → 发布课程到 GitHub Pages → Run workflow** 手动运行，选择 `main`。
4. 在部署记录的 `github-pages` 环境中查看实际站点地址。

工作流只发布 `assets/`、`lessons/`、`reference/` 下允许的静态文件，自动创建根路径入口。不会部署 Agent Server、运行实验室或上传凭据、依赖和整个源码仓库。源码引用改为当前 GitHub 提交或子模块固定提交的链接，因此不需要子模块 SSH 密钥；私有源码仍需访问权限。

当前本地配置的远程是 `g.echo.tech`；仅推送到这个地址不会触发 GitHub Actions。需另行推送或镜像到目标 GitHub 仓库。本流程不自动创建仓库、不修改远程、不自动提交或推送。

本地验证（输出目录必须尚不存在）：

```sh
GITHUB_REPOSITORY=你的组织/你的仓库 node scripts/build-pages.mjs /tmp/course-pages-preview
```

构建脚本不修改原始 HTML，保留本地阅读链接；只对发布副本转换源码链接。GitHub Pages 是静态托管，交互 SVG 在浏览器端工作，后端 API 不会随站点上线。
