# Mission: 从零搭建可调试的 DeepSeek Harness

## Why
通过亲手实现一套从最小 Agent Loop 逐步演进到完整 Web、持久化、沙箱、MCP、子 Agent 与遥测能力的 Harness，掌握每层为什么存在、如何连接，以及出现问题时从哪里下断点。

## Success looks like
- 能独立画出并解释 Client、Agent Server/Host、Agent Runtime、Capability Provider 和持久化层
- 能从空项目逐阶段实现与当前 DeepSeek Harness 等价的关键能力
- 每一阶段都有独立启动命令、自动测试、调试入口和可观察产物
- 能定位一次请求从用户输入到 LLM、工具、Session Log 和 UI 的完整路径

## Constraints
- 使用当前 `deepseek-harness` 源码作为实现依据
- 按垂直切片推进；任何一步失败时都不依赖后续阶段才能调试
- 函数、方法和变量相关示例使用中文注释
- 不自动提交 Git

## Out of scope
- 第一轮不追求逐行复制现有 248 个 workspace 包
- 第一轮不实现商业化多租户、计费结算和大规模 Kubernetes 控制面

