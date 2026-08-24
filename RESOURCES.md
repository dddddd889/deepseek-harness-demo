# DeepSeek Harness 学习资源

## Knowledge

- [DeepSeek Harness 架构](deepseek-harness/docs/architecture.md)
  当前仓库的一手架构说明。用于确认 Cordis、Session Event、Agent Loop 和 Capability Seam 的职责。
- Bun 1.3.14 原生 `Bun.Terminal` / `Bun.spawn`（PTY 与受管子进程）
  本地真实伪终端分配依赖；普通 subprocess 与 shell 使用 Node 标准库。
- [Cordis 入门](deepseek-harness/docs/cordis-primer.md)
  Cordis Context、Service、Event 和 Effect 的基础材料。用于第 1～2 阶段。
- [Agent 生命周期](deepseek-harness/docs/agent-lifecycle.md)
  Turn、Step、LLM 和工具执行的完整时序。用于 Agent Loop 阶段。
- [工具执行管线](deepseek-harness/docs/tool-execution-pipeline.md)
  工具注册、校验、策略拦截和结果落盘的权威说明。
- [会话持久化](deepseek-harness/packages/session/session-persistence/README.zh.md)
  Event Sourcing、恢复、崩溃修复和持久化不变量的实现依据。
- [Web Bundle 组合](deepseek-harness/packages/bundle/web-app/cordis.patch.yml)
  Host Server、API Gateway、Connection 和浏览器插件的真实装配清单。
- [开发指南](deepseek-harness/docs/development.zh.md)
  上游 Harness 的构建顺序、测试命令和 Host/Client 双编译面的权威来源；实验项目自身统一使用 Bun。

## Wisdom (Communities)

- [DeepSeek Harness GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions)
  用于验证插件设计、兼容性判断和真实部署问题。
- [DeepSeek Harness GitHub Issues](https://github.com/deepseek-ai/deepseek-harness/issues)
  用于观察维护者如何划分 bug、能力 seam 和架构边界。

## Gaps

- 当前仓库仍处于开发者预览阶段，最终课程需随配置格式和包边界变化持续校准。
