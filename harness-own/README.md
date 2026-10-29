# Harness 练习工程

本目录由原来的独立 `harness-own` 工程迁入，现在是 `deepseek-harness-demo` 的普通子目录，和[70 节教材](../tutorial/linear/README.md)使用同一份 Git 仓库。后续在当前仓库提交和推送即可，不再维护另一套源码引用。

原工程已提交到第 040 步；本机正在进行的第 041 步代码与调试配置继续保留。这里是现有学习进度，不能清空，也不要按第 000 步重新覆盖。

## 进入工程

在当前仓库目录运行：

```sh
export REPO="$(git rev-parse --show-toplevel)"
export COURSE="$REPO/tutorial/linear"
export PROJECT="$REPO/harness-own"
cd "$PROJECT"
bun --version
```

继续使用 Bun 1.3.14。当前电脑已有的 `node_modules`、`.env` 和 `tmp/` 已随目录一起迁移，仍受本目录 `.gitignore` 保护。新检出需要安装依赖时，执行 `bun install --frozen-lockfile --ignore-scripts`；真实模型配置只在自己的本地 `.env` 中维护。

## 教材、调试与运行

- [课程总入口](../tutorial/linear/README.md)与[完整目录](../tutorial/linear/INDEX.md)。
- 用 VS Code 打开仓库根目录的 [harness-course.code-workspace](../harness-course.code-workspace)，在 `harness-own` 文件夹中运行调试。原有 `${workspaceFolder}` 仍指向练习目录。
- [032 内存流、TCP 与 WebSocket 示例](docs/032-rpc-transports.md)。
- 当前 CLI 入口仍是 `bun run start "任务文字"`；具体能力和验证范围以正在学习的课次为准，迁移不补做后续课程。

## Git 与迁移记录

本目录不再包含独立 `.git`。原来的 Git 元数据和包含 42 次提交的历史备份保存在主仓库本机的 `.git/harness-own-migration/`，不作为网页或源码文件发布。详见[迁移记录](MIGRATION.md)。

原电脑上的 `ws/github.com/harness-own` 和旧教材使用的 `ws/harness-own` 均保留兼容链接，实际代码只有本目录这一份。以后优先使用上面的仓库相对路径，避免依赖特定电脑上的绝对路径。
