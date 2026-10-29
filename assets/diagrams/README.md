# 课程可视化图解

本目录包含全站总体架构图，以及 17 课各自的系统定位、模块关系、调用时序、异常分支图，共 69 张。

- HTML 通过本地 `<img>` 引用 SVG，离线可显示，不加载 CDN 或远程脚本。
- `course-data.mjs` 是课程图的维护源；`build.mjs` 中的 `overview()` 是总图维护源。
- `context-data.mjs` 是逐课系统定位与三框架对比的维护源；`build-context.mjs` 用同一张概念地图生成 17 张不同高亮图，并输出页面更新补丁。
- 每课首个阅读入口指向正文概念索引，清单中每个名称直达自己的三框架对比。章级矩阵折叠为可选概览；系统定位图保留。路线首页仍提供辅助性的 17 行职责总表，不能替代逐概念阅读。
- `.svg` 是页面直接使用的矢量图，`.mmd` 是同一数据生成的 Mermaid 源码，可用于其他 Mermaid 编辑器。
- 修改定义后重新生成；直接编辑生成的 `.mmd` 或 `.svg` 会在下次生成时被覆盖。

## 重新生成与校验

在仓库根目录运行：

```sh
bun assets/diagrams/build.mjs
bun assets/diagrams/build-context.mjs
python3 assets/diagrams/verify.py
```

两个生成器的 `--embed` 都输出 apply_patch 补丁，不自动编辑 HTML。`build.mjs` 跳过已存在的局部图解；`build-context.mjs` 可更新其标记范围内的定位与对比内容，不覆盖其他正文。修改 `context-data.mjs` 后，需应用后者输出的补丁。

## 阅读边界

### 全量功能与调试路线总图

在仓库根目录运行 `python3 scripts/build-feature-debug-plan.py`，从同一份功能与步骤定义生成两份专题页面和 `feature-plan/overview.svg`、`feature-plan/overview.mmd`。功能编号与调试步骤双向链接；生成器核对源码包组覆盖、步骤依赖和参考测试路径。该图表示建议建设顺序，不表示一次请求的调用顺序；具体依赖和短路线见调试卡，也不计入固定的逐课图数量。

### Web API 与 ACP 专题总图

`build-web-acp.py` 从同一份领域、节点和连线定义生成 `web-acp/overview.svg` 与 `web-acp/overview.mmd`，由 `reference/web-api-acp-domain-comparison.html` 引用。专题文件位于子目录，不计入固定的逐课图数量。

```sh
python3 assets/diagrams/build-web-acp.py
```

总图区分用户、两种客户端进程、Host 内部独立接入与共用运行时、远端模型服务。两个入口按职责合画，不声称默认同进程同时装配；共用实现也不表示共享同一会话或 Agent 实例。图中只画当前实现，未来通用 UI 后端接口的建议留在正文中明确标注。

模块图是本课职责关系，不等同于每个节点都对应独立类；时序图是一个代表性场景，不表示所有外部能力都会在一次请求中调用。

总图中的实线表示当前实现关系，虚线表示可选或独立教学扩展。当前 HeadlessHost 创建 Agent 时没有默认注入 ToolRegistry；实验室 TelemetrySink 是可替换接口，不能据此推断已经向真实 Collector 发送 OTLP。

新增的逐课定位图是概念地图：保留全部 17 个章节的系统职责，只高亮当前课。它不声称三套框架使用相同的包结构，也不是实验室默认装配图。箭头选取关键关系，交叉处无连接语义；第 1～3 课为横切底座，第 17 课是观测与验证职责。

对比口径：DeepSeek Harness 使用本地原仓库 `99f6f02fecdb7dff40c3fbc9470f5907c29f74ca`；DeepAgents 指 LangChain DeepAgents；OpenHands 指 Software Agent SDK，排除旧 V0 混用。在线文档核对日期为 2026-08-28，不代表安装验证了对应包版本。每个机制与边界均附一手来源，解读明确作为归纳；未知信息不推断为不支持。

特别注意：原版 DeepSeek 的浏览器载体是 HTTP POST 与双 WebSocket，headless 组合不启动 HTTP 服务；这与实验室 HeadlessHost/RPC/SSE 演示不同。当前 OpenHands SDK 也支持 OTel Traces，不能写成“不用 OTel”。

## 校验范围

### 正文逐概念对比

`concept-data.mjs` 为每个具体概念独立维护问题、三框架实现、各自依据和区别。`build-concepts.mjs` 将对比嵌入指定正文小节，并把能力清单中的名称链接到该概念；章首矩阵不能替代这些正文内容。

```sh
# 查看全站覆盖与尚待应用的页面更新。
bun assets/diagrams/build-concepts.mjs
# 输出指定课程的更新补丁，交给 apply_patch 应用。
bun assets/diagrams/build-concepts.mjs 0008 --embed
# 完成验收：只要还有未覆盖概念，就以非零状态退出。
bun assets/diagrams/verify-concepts.mjs
# 施工检查：允许未覆盖，但仍检查已写入内容的结构与链接。
bun assets/diagrams/verify-concepts.mjs --partial
```

正文校验从 HTML 能力清单推导覆盖范围，检查概念唯一性、实际所在小节、清单锚点、问题、三框架列、区别说明与本地依据存在性。远程来源只校验 URL 和官方域名，不以此声称已验证网页内容；论述是否准确、依据是否充分仍需逐项人工审阅。`--partial` 通过不代表工作完成。

校验器检查全部 69 个 SVG 的 XML、标题、可见图形、数字坐标范围、对应 Mermaid 标签，以及 18 个 HTML 页面的图片、图源和总体图回链；另检查每课四项定位说明、三框架条目与本地来源。图像可以用 macOS `sips` 离线栅格化抽查，不需要执行网页脚本。结构检查不能证明论述正确，语义须对照来源审阅。Mermaid 仅检查图类型与标签一致性，不宣称已经通过第三方 Mermaid 引擎解析。

Electron 桌面扩展图位于 `feature-plan/desktop.svg` / `.mmd`，以及更新后的里程碑 `feature-plan/overview.svg` / `.mmd`；均由 `scripts/build-feature-debug-plan.py` 生成。桌面由 24～27 的 Web 闭环分支进入 40～46，图中区分 Renderer、preload、main、Host、Agent Loop 与模型。
