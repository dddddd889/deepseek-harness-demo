# 逐概念对比验收记录

核对日期：2026-08-28。

## 需求与交付

要求是在具体概念内比较 DeepSeek Harness、LangChain DeepAgents 与 OpenHands，不以章节或首页汇总代替。

- 17 课能力清单共 116 项；每项均有独立正文对比，包含具体问题、三个框架的说明与来源、区别说明。
- 对比位于该概念所属正文小节，原有教学讲解保留；能力清单中的名称直接链接对应对比。
- 每课首个导航入口为「概念逐项对比」，章级矩阵折叠为可选概览。
- 正文清单前明确区分 harness-lab 教学实现与上游实现。

## 覆盖审核

已逐课检查能力清单及独立正文标题。分层图、主概念导览和综合场景是这些具体概念的组合讲解；调试、练习和验收段落不是额外框架机制清单。第 11 课四个量分别落在实际用量、词元估算与上下文压力的对比中；第 12 课综合场景中的目录、Skills、MCP、搜索、抓取、LSP 和附件均有独立对比。

## 内容审核重点

- 运行环境：实验室 Bun 与 DeepSeek 上游 Node/TypeScript、Python 框架分开。
- 循环与工具：模型增量、完整消息和持久事件分层；取消信号不等于资源已回收。DeepAgents 的并行说明已补为 ToolNode，OpenHands 的终端裁剪说明已补为实际工具展示路径。
- 本地与权限：cwd 不等于访问围栏，审批不等于内核隔离；DeepSeek 的 never 不等于 OpenHands 的 NeverConfirm。
- 恢复：JSONL/Zstandard 事件、LangGraph 检查点、OpenHands 状态加事件分别说明；Fork 的切点、统计与工作区共享分别说明。
- 上下文与外部能力：估算不等于计费用量，裁剪不等于摘要；仅能确认扩展接口时不宣称存在等价内置实现。
- 并发编排：普通 Job、一次性子智能体、可继续子智能体以及工作流分别比较，保存子会话不等于保存工作流进度。
- 宿主与界面：上游 headless 不开 HTTP；会话双 WebSocket 与插件 HMR SSE 分开；请求幂等、运行重叠策略、外部副作用分别说明。
- 观测与成本：DeepSeek OTel Logs、OpenHands OTel Traces 和 LangSmith trace/run 分开；遥测不是恢复源。教学 PriceBook/picoUSD 不归给上游。

## 检查命令

```sh
bun assets/diagrams/verify-concepts.mjs
bun assets/diagrams/build-concepts.mjs
bun assets/diagrams/build-context.mjs
python3 assets/diagrams/verify.py
git diff --check
```

严格概念检查结果为 116/116、缺失 0；两个生成器无待更新页面。图示与本地引用检查通过。

## 证据边界

这是文档对比交付，不是三套框架的安装、兼容或性能测试。依据为本地 DeepSeek 源码及各框架官方资料；链接已随每条陈述提供。结构校验只证明覆盖、位置、文本一致性与链接结构，不能替代内容审核，也不保证远程文档未来不变。未核实的内置能力或可靠性保证已在对应条目中保留限定说明。

未执行网页浏览器渲染验收；本次页面检查覆盖 HTML 结构、等宽对比列、滚动容器、锚点与图示文件，不宣称已验证所有浏览器的视觉效果。
