# 按AgentManager与磁盘SessionStore实现：模块、接口与迁移设计

更新：2026-10-29。状态：用户已选定目标，当前只交付可实施设计，尚未修改后台代码。本文确定的结构是AgentManager → SharedServices／SessionStore／ConversationHost；会话必须使用磁盘FileSessionStore。原实现是迁移材料，不能用它缺少这些模块来否定目标。

[上一份现状核对](/Users/yhding/ws/github.com/deepseek-harness-demo/reference/agent-host-tams-complete-architecture.md)保留当时TAMS v5／实施v3的读取证据。本稿已重新对照架构v7／替换方案v12／实施v10：持久Host、存储注入、只读查询及移除独立MemoryDebugStore已经纳入外部方案的D8，不再称为遗漏。本稿细化文件实现；ArtifactStore及其下载API仍是额外设计，不能成为TAMS直调本期的新前置门禁。新SessionJournal外壳也是待评审实现提案，不能冒称外部方案已确认其具体线格式。

## 1．目标结构就按这棵树

~~~text
AgentManager                               应用唯一入口与Host索引
├─ SharedServices                          应用级共享能力
│  ├─ Settings／Credentials                 配置与服务端凭据解析
│  ├─ ModelRegistry／Routes                 冻结模型绑定与路由能力
│  ├─ ConnectionPools                       模型、证据、PG／Redis共享连接
│  ├─ ExecutionPool／ObservationPool         执行与观察容量
│  └─ Observability
│     ├─ ObserverHub                        安全分发有限观察
│     ├─ Logger                             程序诊断
│     └─ OTelService → Queue → Exporter → Collector
├─ SessionStore：FileSessionStore           长期会话的权威磁盘日志
│  ├─ header.json                           身份、版本、创建信息、耐久水位
│  ├─ events.jsonl                          追加事件，保留多次执行
│  ├─ events.jsonl.lock                     固定锁文件，由内核锁决定占用
│  └─ materials/（按需）                    受控现场与采集覆盖信息
├─ SessionQueryService                     不创建Host的只读历史与调试查询
│  └─ 有界分页／投影缓存                    可丢弃，从SessionStore重建
├─ ArtifactStore（附加扩展）                大JSON等完整文件交付
│  └─ 会话目录/artifacts/                   不替代PG正式结果
├─ ConversationHost A                       长期会话运行外壳
│  ├─ Conversation                          会话元信息、可重建历史／消息投影
│  ├─ Workspace                             本会话的执行环境描述与工具能力
│  ├─ AgentRunner                           中立模型与工具循环
│  ├─ AgentDriver                           串行提交、取消、等待
│  ├─ AgentLifecycle                        本Host加载、卸载、资源退出
│  ├─ 观察上下文与订阅                      本会话身份、游标、撤销函数
│  └─ Execution（同一时刻至多一个）
│     ├─ 本次冻结配置、运行时Conversation、Turn／Step
│     ├─ 本次资源Owner／工具／Cleanup
│     └─ 现有一次性Driver／Lifecycle的适配实现
└─ ConversationHost B
   └─ 自己的会话、写锁、投影、当前Execution与订阅
~~~

ArtifactStore是针对“大JSON文件结果怎么取”的附加模块。SharedServices／SessionStore／SessionQueryService及可选ArtifactStore由应用拥有；Host只关闭自己打开的会话句柄、执行单元和订阅，不关闭全局服务。评估业务的协调器、Schema、Check与判定收据留在Host外，由可信应用装配根连接；通用Host／Runner不接收这些业务类型。

Host层的AgentDriver是长期协调器，内部每次Execution使用一个新的现有一次性Driver。迁移时应给内部适配器明确命名，避免同名误读；不能把旧Conversation的terminal改回false来复用。

## 2．先统一几个身份与生命周期

| 身份／对象 | 生命周期 | 为什么独立 |
| --- | --- | --- |
| SessionID | 从会话创建到删除 | 一份持久历史，跨多次提交、Host卸载和进程重启。 |
| Host实例／WriterID | 本次打开会话期间 | 同一Session重新打开会有新运行对象和新锁拥有者。 |
| ExecutionID | 一次获准提交到彻底收尾 | 同一Host第二次提交有新的执行、预算、资源和期限。 |
| Runtime ConversationID／LogEpoch／原seq | 原内核一次执行 | 保留原事件身份和Hash，不改成磁盘全局序号。 |
| Session journalSeq | 本会话磁盘日志顺序 | 串起多个Execution，与原事件seq分开。 |
| Run／阶段Attempt／Lease／fencing | 原正式业务调度周期 | 继续由PG授予，不借磁盘锁替代。 |
| ArtifactID（扩展） | 一份已提交产物 | 指向不可变文件版本，关联Session与Execution，不改变PG正式结果。 |

例子：一个原Core任务先产出候选，业务Check要求纠错，再运行下一Turn。这始终是Execution A、同一次Driver.Do、同一Owner与累计额度，不新建Execution B。只有A终态且真实清理完成，原业务规则又授予合法新任务资格，才允许B；换SessionID／ExecutionID不能给原TaskKey重新发额度。同阶段不同维度、链和摘要段仍保留各自原TaskKey，阶段共享ToolSequence也不复制或清零。

空闲Host不占执行Owner、模型请求缓冲、工具进程或业务Lease。Host数量、历史缓存字节与正在执行数分别限额；空闲卸载仅释放内存与会话锁，磁盘数据保留。

## 3．目标文件布局与各文件用途

~~~text
DATA_DIR/
└─ sessions/
   └─ <session-id>/
      ├─ header.json
      ├─ events.jsonl
      ├─ events.jsonl.lock
      ├─ materials/（按需）
      └─ artifacts/
         └─ <artifact-id>.json
~~~

前三个文件按用户指定布局落地；artifacts是产生完整文件结果时才使用的子目录。日志中不能记录写到一半的产物为可用。实际目录名由服务端生成并校验，客户端不提交任意绝对路径。

| 文件 | 谁写、何时写 | 谁读 | 不是做什么 |
| --- | --- | --- | --- |
| header.json | Store创建；元信息按expectedRevision在会话锁内原子更新，checkpoint只是可重建索引 | Store打开、列目录、校验身份／水位 | 不存模型全文、凭据或可复活的运行对象，不单独证明事件已提交。 |
| events.jsonl | 当前SessionJournal拥有者顺序追加 | 受控历史读取、投影、恢复 | 不覆盖旧事件，不成为PG事务的替代品。 |
| events.jsonl.lock | Store打开固定文件并持有内核独占锁；内容仅诊断 | Store判断内核锁能否取得 | 不是有文件就占用，也不靠PID文本抢锁。 |
| artifacts/<id>.json | ArtifactStore写临时文件、校验并提交后变不可变 | 授权的程序、下载接口与受控工具 | 不等于Spill预览，不靠模型文字路径证明成功。 |

本设计第一版运行在支持flock的Linux／macOS本地文件系统，使用持久卷或持久本机目录。容器可写层销毁会丢文件，必须把DATA_DIR挂载到持久存储。它不承诺任意NFS／对象存储上的共享写锁，也不承诺多副本自动接管本地会话。

同一Session只能路由到持有它文件的实例。跨实例迁移须先关闭原Host、确认退出、转移完整目录后再打开；不能让负载均衡随机把同Session发往另一台各自创建空历史。通用计算Worker可以多实例，长期磁盘会话所在的服务需按该限制部署；集群共享持久会话属于后续独立存储合同，不能静默上线。

## 4．公开接口：调用方只接触Manager和Host

以下是拟新增Go合同示意，类型可以独立检查，但不是已存在的后台API。对应拟建文件为internal/agentmanager/contracts.go及internal/sessionstore/contracts.go，落地目标是TAMS后台仓库，不是本教材仓库。代码注释说明每个入口的边界。

~~~go
package targetdesign

import (
    "context"
    "encoding/json"
    "time"
)

// SessionID表示长期会话；不可与证据服务原有SessionID混用。
type SessionID string
// ExecutionID表示一次执行，与长期会话和物理模型调用分别编号。
type ExecutionID string
// Head表示已确认耐久的日志前沿，同时限定读取的字节范围。
type Head struct {
    Seq uint64             // 本会话连续序号。
    OffsetBytes int64      // 最后一条完整记录之后的字节位置。
    Hash string            // 该前沿的记录摘要。
}
// CreateSpec只接受可信应用装配的引用，凭据正文不进入磁盘。
type CreateSpec struct {
    TenantID string        // 可信租户身份。
    Title string           // 创建时名称，后续更名应记录事件。
    ProfileRef string      // 已验证的中立配置引用，不接收业务发布对象。
    WorkspaceRef string    // 已授权的执行环境引用。
}
// Header保存会话身份及可修订元信息；Checkpoint是可重建索引。
type Header struct {
    FormatVersion uint32   // 磁盘格式版本。
    SessionID SessionID    // 长期会话身份。
    TenantID string       // 读取前必须校验的租户。
    LogEpoch string       // 本磁盘日志世代，不能与原Runtime的LogEpoch混用。
    CreatedAt time.Time   // 创建时间。
    Revision uint64      // 元信息的乐观并发版本。
    Title string         // 经可信应用命令更新的标题。
    Checkpoint Head       // 可由日志复核的耐久前沿。
}
// SubmitInput的RequestID用于同一次提交的幂等重试。
type SubmitInput struct {
    RequestID string      // 同意图重试不换ID；不同内容同ID冲突。
    Text string           // 本次人类输入，按输入上限校验。
    BindingRef string     // 可信装配生成的本次冻结绑定引用。
}
// RunRef是已耐久接收后的执行句柄，不表示模型已经成功。
type RunRef struct {
    SessionID SessionID   // 所属会话。
    ExecutionID ExecutionID // 本次执行身份。
    Accepted Head         // 接收事件的耐久回执。
}
// ArtifactRef指向已提交的不可变产物，不接受任意模型路径。
type ArtifactRef struct {
    ID string             // 服务器分配的产物身份。
    Locator string        // 服务端生成的相对定位符。
    Bytes int64           // 实际UTF-8或文件字节数。
    SHA256 string         // 已提交文件摘要。
    MediaType string      // 如application/json。
}
// ExecutionStatus描述一次执行；候选交接仍是非终态。
type ExecutionStatus string
const (
    StatusAccepted ExecutionStatus = "accepted" // 已耐久接收，尚未启动。
    StatusRunning ExecutionStatus = "running" // 当前Execution运行中。
    StatusAwaitingBusiness ExecutionStatus = "awaiting_business" // 等可信业务回调，Do尚未结束。
    StatusSucceeded ExecutionStatus = "succeeded" // 必要完成事实与收据满足合同。
    StatusFailed ExecutionStatus = "failed" // 确认失败。
    StatusCancelled ExecutionStatus = "cancelled" // 本次执行因取消结束。
    StatusInterrupted ExecutionStatus = "interrupted" // 进程中断，不能自动重做副作用。
    StatusReconciliation ExecutionStatus = "reconciliation_required" // 事实待正式对账。
)
// Result是中立执行回执；业务API另外关联正式收据，不把评分对象传入Host。
type Result struct {
    Status ExecutionStatus // 不能用业务接受决定代替执行终态。
    AuditRef string        // 不解释的审计关联ID，不能据此判定评分通过。
    Artifacts []ArtifactRef // 校验并提交后的产物列表。
    FinalHead Head        // 本次完成事实的耐久前沿。
}
// RecordDraft的Payload必须是版本化纯值，不能持有运行对象或闭包。
type RecordDraft struct {
    EventID string        // 稳定事件身份，Append不明时用同ID查证。
    Type string           // 闭合合同中的事件类型。
    ExecutionID ExecutionID // 会话级事件可为空。
    Payload json.RawMessage // 独立拥有的完整有界JSON。
}
// StoredRecord保留写入时的精确body字节，不经map重排后重算原Hash。
type StoredRecord struct {
    Body json.RawMessage  // 含seq、身份、时间、prevHash和payload。
    RecordHash string     // 对版本化域及精确Body字节计算。
}
// Receipt表示事件已达到耐久前沿，而非仅进入内存队列。
type Receipt struct { EventID string; Head Head }
// Journal是单会话写入句柄；Close释放自己的FD和内核锁。
type Journal interface {
    Header() Header // 返回不可变副本。
    Append(context.Context, Head, RecordDraft) (Receipt, error) // 检查前沿并耐久追加。
    Lookup(context.Context, string) (StoredRecord, bool, error) // 以原EventID核对不明写入。
    Scan(context.Context, Head, uint64, int, func(StoredRecord) error) error // 在固定前沿内有界读取。
    Flush(context.Context, Head) error // 等待指定前沿耐久，不授予新执行权。
    Close(context.Context) error // 真实IO退出后关闭，失败或超时不伪报完成。
}
// SessionStore由应用拥有；Host只关闭借用的Journal。
type SessionStore interface {
    Create(context.Context, CreateSpec) (Journal, error) // 原子创建目录和首记录。
    Open(context.Context, SessionID) (Journal, error) // 取锁、核验、恢复后返回。
    OpenRead(context.Context, SessionID) (ReadView, error) // 只读已确认前沿，不创建Host或工具。
    UpdateHeader(context.Context, SessionID, uint64, HeaderPatch) (Header, error) // 同会话锁内核expectedRevision。
    List(context.Context, string, string, int) ([]Header, string, error) // 按租户分页。
    Close(context.Context) error // 仍有活跃Journal时不能强关。
}
// HeaderPatch只改允许的展示元信息，不能覆盖身份或事件确认水位。
type HeaderPatch struct { Title *string }
// ReadView只读已确认范围；短期读者不会取得会话写入权。
type ReadView interface {
    Header() Header // 返回身份和确认水位的副本。
    Scan(context.Context, Head, uint64, int, func(StoredRecord) error) error // 固定前沿分页。
    Close() error // 撤销本次读取，不能关闭写者和共享Store。
}
// SessionQueryService从持久源读取，不依赖活跃Host或另一份历史副本。
type SessionQueryService interface {
    ReadAt(context.Context, SessionID, Head, uint64, int) ([]StoredRecord, error) // 核身份及前沿，有界分页。
}
// Cursor限定同一会话、磁盘世代及已确认前沿，避免跨日志误用seq。
type Cursor struct {
    SessionID SessionID   // 长期会话身份。
    LogEpoch string       // 磁盘世代。
    Head Head             // 消费者已经确认的前沿。
}
// HostSnapshot只包含有限状态，不返回全部历史或可变执行对象。
type HostSnapshot struct {
    Header Header         // 创建身份与版本。
    State string          // 下文规定的Host状态。
    Current ExecutionID   // 没有执行时为空。
    Cursor Cursor         // 本快照来源前沿。
}
// HostEvent是一个已耐久记录的订阅投影，不是第二本可写日志。
type HostEvent struct { Cursor Cursor; Type string; Payload json.RawMessage }
// Subscription有界推送；落后时断开，让客户端按游标补读，不无限积压。
type Subscription interface {
    Next(context.Context) (HostEvent, error) // 只暴露调用者获准读取的投影。
    Close() error // 撤销本订阅，不关闭Host或Journal。
}
// Host是长期会话入口，当前同一时刻只运行一个Execution。
type Host interface {
    Submit(context.Context, SubmitInput) (RunRef, error) // 耐久接收后再开始执行。
    Interrupt(context.Context, ExecutionID) error // 先发取消，不因写盘失败阻止取消。
    Wait(context.Context, ExecutionID) (Result, error) // 等整个可信回调及必要清理，不在候选处返回完成。
    Snapshot(context.Context) (HostSnapshot, error) // 返回固定前沿的有界只读状态。
    Subscribe(context.Context, Cursor) (Subscription, error) // 校验同一世代，先补读后追赶。
    Close(context.Context) error // 卸载，不删除历史，也不关闭共享服务。
}
// AgentManager在本进程内确保同一会话只有一个已加载Host。
type AgentManager interface {
    Create(context.Context, CreateSpec) (Host, error) // 建会话并加载。
    Open(context.Context, SessionID) (Host, error) // 已加载时复用；并发Open合并创建。
    CloseSession(context.Context, SessionID) error // 关闭并从索引移除。
    Close(context.Context) error // 禁止准入、关闭Host，再由应用关共享服务。
}
~~~

所有接口仍须绑定可信租户／操作者上下文，不能仅凭SessionID读文件。会话ID必须是服务端认可的单段身份；数据根目录与模型Workspace隔离，文件拒绝符号链接／非普通文件，使用私有目录和文件权限。对外HTTP／ACP适配器映射到这些方法；不让UI拿到原始文件句柄或直接调用业务Provider。

Submit默认不新增隐式队列：不同RequestID遇到运行中返回SESSION_BUSY；同RequestID同内容返回原RunRef，相同ID不同内容返回冲突。若将来需要steer或下一Turn队列，要另定义提交目标和持久化语义，不能顺便偷塞进本接口。

## 5．共享能力与业务／模型层怎么接

~~~mermaid
flowchart TB
    API["HTTP／ACP适配器"] --> M["AgentManager"]
    M --> H["ConversationHost"]
    M --> S["FileSessionStore"]
    M --> A["FileArtifactStore"]
    H --> E["新Execution：独立Owner与原Driver"]
    H --> SS["SharedServices：只借用"]
    E --> CORE["中立Runner／Loop／消息来源合同"]
    B["Host外业务协调器：冻结配置、Check、证据、PG审计"] --> CORE
    B --> L["拟llmchat：native Chat与单次HTTP"]
    B --> E
    L --> T["TAMS"]
    B --> PG["PG：Run／Lease／调用审计／正式结果"]
    CORE --> DL["同步DurableLog接缝"]
    DL --> S
    SS --> O["共享Observer与OTel"]
    E -. "有限观察" .-> O
~~~

ModelRegistry保存已核定的模型／能力与不可变绑定；Routes按可信选择解析到同一冻结配置。业务用途／维度先由evaluationmodel选定，不进入通用HTTP层。首版仍只有TAMS原生Chat活动路径，不为Registry新增旧Choreo回退或动态供应商平台。

Workspace在TAMS实现为EvidenceWorkspace，包装当前JudgeWorkspace的受控证据工具。会话持有环境描述和范围，具体工具实例由Execution创建／释放。磁盘产物目录不是允许模型任意读写宿主机器的权限。

TAMS活动路径不再装配GoalController／goal.Run。Host外业务协调器持有Parse、评分Schema、Check、原MaxRepairs和必要决定记录器；Runner只返回候选原来源和有界读取租约。业务确认决定并幂等提交普通反馈后，才在同一次Do内继续下一Turn。通用Host／Runner／llmchat不接收Check、GateRef、RuleHash或业务判定枚举。

### 模型、Prompt、工具与版本到底存在哪里

下表是原版DeepSeek源码事实，不能当作上述TAMS后台已经实现的接口。

| 内容 | 原版保存位置 | 保存范围 |
| --- | --- | --- |
| 模型与调用参数 | EventLog的request/header.data.header.config、adapterDefaults | 当次有效provider／model和控制参数；发生变化追加新快照。 |
| 最终system提示词 | EventLog的system/message.data.message | 组装后模型可见正文；不自动保存所有注册函数、模板仓库和依赖版本。 |
| Tools Schema | request/header.data.header.tools | 公开名、说明、参数Schema等定义，不是执行函数源码或其版本。 |
| 已加载Skill | skill工具结果，或显式调用时的user/message | 保存进入历史的指令／结果；没有默认冻结scripts、references等完整资源包。 |
| MCP工具映射 | 活动工具注册表和连接闭包；Schema及调用／结果另进入日志 | 公开名映射回原始工具名是运行时能力，没有默认的完整会话级服务版本快照。 |
| Agent预设身份 | SessionHeader.agentPreset，即单独header元信息 | 只是预设ID，不等于以上资源的不可变版本清单。 |

白话例子：昨天的日志可以证明模型见过哪段Skill文字，以及调用mcp__docs__search时的Schema和结果。今天重新加载Skill目录或重连MCP，实际脚本／远端实现仍可能更新。能还原当时模型看见什么，不等于能恢复当时所有可执行资源。原版允许配置、工具和提示词变化，不能写成“整个Session永久固定五项”。

~~~mermaid
flowchart LR
    C["当前配置、插件与外部资源"] --> R["请求组装"]
    R --> H["request/header：模型参数与工具Schema"]
    R --> P["system/message：最终提示正文"]
    H --> E["EventLog"]
    P --> E
    E --> V["还原当时的模型输入视图"]
    C --> X["实际执行：工具函数、Skill文件、MCP连接"]
    Note["原版没有自动把全部可执行资源存成会话版本包"] -.-> X
~~~

<details>
<summary>展开原版事件内容摘录：模型／Schema与system分开保存</summary>

以下是字段结构示意，提供方和模型为示例值；只摘type与data，省略真实事件的seq、时间及surface元数据，不可整段当作原版磁盘文件导入。

~~~json
[
  {
    "type": "system/message",
    "data": {
      "turn": 1,
      "step": 1,
      "message": {
        "id": "system_message_demo",
        "role": "system",
        "source": {
          "kind": "system-prompt"
        },
        "content": [
          {
            "type": "text",
            "text": "你是编码助手。先检查证据，再回答。"
          }
        ]
      }
    }
  },
  {
    "type": "request/header",
    "data": {
      "reason": "initial",
      "header": {
        "config": {
          "provider": "provider_demo",
          "model": "model_demo",
          "temperature": 0.2
        },
        "tools": [
          {
            "name": "mcp__docs__search",
            "description": "搜索文档",
            "parameters": {
              "type": "object",
              "properties": {
                "query": {
                  "type": "string"
                }
              },
              "required": [
                "query"
              ]
            }
          }
        ]
      }
    }
  }
]
~~~

</details>

数组对应实际先后：Agent.step先提交system/message，再由buildRequest提交request/header。后续temperature或Schema变化会追加reason=change的新完整header；提示词变化也通过新的system事件及相应surface操作更新模型视图，旧日志保留。上面没有Skill版本包、MCP原始名／服务部署版本，这些不会凭公开工具名自动补出来。

本文的BindingRef是拟新增的中立执行绑定引用，不是原版字段。可信装配应在接收执行前核对不可变资源并保存实际中立模型设置、基础提示材料和工具Schema的内容／可解析持久引用；execution/accepted引用该绑定。最终每次请求的system和messages仍按当次输入提交记录，不能只存模板Hash。凭据正文不写入日志。业务用途、Check和规则Hash继续由业务发布／审计层保存，不能塞进通用绑定类型。

最新TAMS三份方案只规定每原Core任务冻结模型、参数、Prompt／证据和业务策略，没有Skill／MCP冻结施工项。Skill全资源包与MCP版本绑定属于另行扩展：至少要保存内容版本和可用资源，MCP还需server身份、publicName、rawName、Schema版本及可核验部署版本；仅有Hash或稳定工具名不足以重新装配。这里不为TAMS本期增加这两套平台。

## 6．磁盘Append：什么时候才算保存成功

一次逻辑提交的成功回执必须走完：检查expectedHead与幂等 → 固定commitId和完整事件组 → 编码有界封套并计算Hash → 写完整JSONL及换行 → fsync日志 → 安装投影并发布确认Head。文件短写必须循环处理，组内事件不能半批可见。必要写入／同步失败不能发布持久成功。一个封套可以只有一条事件，也可以包含原子提交的一组原事件。

header的checkpoint只是加速扫描的索引，不能取代完整commit封套；它可以落后。更新它仍需临时文件fsync、原子rename和目录fsync，但不能把“checkpoint更新失败”解释为日志一定没提交后重新分配commitId。按原身份核对已完整同步的提交，恢复索引或明确返回不明。标题等元信息通过UpdateHeader(expectedRevision)在同一会话跨进程锁内原子更新；失败后锁内重读，不直接覆盖其他进程的revision。

header包含不可变身份、磁盘logEpoch、格式版本和checkpoint(seq／offsetBytes／hash)。日志是事件事实，checkpoint必须能在日志中找到，不能领先日志。创建时先在DATA_DIR/sessions下的受控临时目录完整初始化，fsync内部文件与该目录，再无覆盖地发布最终目录并fsync父目录DATA_DIR/sessions；完成后才返回Create成功。中途目录不进入List结果。

Hash版本固定为session-record-sha256-v1：先把类型化RecordBody编码成一份UTF-8 JSON，RecordHash=SHA256(UTF8("harness-session-record-v1\n") + 精确body字节)。body自身含prevHash；磁盘外壳保存body和recordHash。核验时使用解析器保留的原body片段，不经map重排。Hash只是损坏检测，不是签名，也不授予业务执行权。

EventID相同且Type／ExecutionID／Payload字节摘要相同，返回原收据；同ID不同内容拒绝。新事件expectedHead不匹配拒绝。幂等检查先于新事件前沿检查，使回执丢失后可以用同ID取回原结果。

写入失败可能已经落盘：Journal进入不可继续写状态，调用方使用原EventID查证，或关闭后重新取锁恢复；不能换新ID盲追加，更不能重新调用模型来弥补日志错误。必要记录失败会阻止新执行，但不阻止发取消信号和在真实退出后释放资源。Lookup读到某条记录并不自动证明其已耐久：只有位于确认checkpoint内，或重新Open核验并补Flush后，才可返回耐久回执。

下面展示“会话创建→提交已接收但尚未启动→进程恢复时标中断”的完整教学磁盘样本。没有模型或工具结果，不冒充一段完整运行；实际记录字节和checkpoint由示例计算。

<details>
<summary>展开header.json完整教学示例</summary>

~~~json
{
  "formatVersion": 1,
  "sessionId": "11111111-1111-4111-8111-111111111111",
  "tenantId": "tenant_demo",
  "logEpoch": "22222222-2222-4222-8222-222222222222",
  "createdAt": "2026-10-28T12:00:00Z",
  "checkpoint": {
    "seq": 3,
    "offsetBytes": 1482,
    "hash": "1b483baf4604e3b21881478cefd7d629a7a45200c2dc3a206675ec30949fa40c"
  },
  "revision": 1
}
~~~

</details>

<details>
<summary>展开events.jsonl：每一行都是完整记录</summary>

~~~jsonl
{"body":{"formatVersion":1,"sessionId":"11111111-1111-4111-8111-111111111111","logEpoch":"22222222-2222-4222-8222-222222222222","seq":1,"eventId":"event_create","time":"2026-10-28T12:00:00Z","type":"session/created","executionId":"","prevHash":"0000000000000000000000000000000000000000000000000000000000000000","payload":{"title":"证据分析","profileRef":"profile_demo_v1","workspaceRef":"workspace_demo"}},"recordHash":"4bda3622432e8766296579704f33a7dee0142c9f6aaba526bb30e40f843b6384"}
{"body":{"formatVersion":1,"sessionId":"11111111-1111-4111-8111-111111111111","logEpoch":"22222222-2222-4222-8222-222222222222","seq":2,"eventId":"event_accept","time":"2026-10-28T12:00:00Z","type":"execution/accepted","executionId":"exec_demo_1","prevHash":"4bda3622432e8766296579704f33a7dee0142c9f6aaba526bb30e40f843b6384","payload":{"requestId":"request_demo_1","text":"分析这段会话","bindingRef":"binding_demo_1"}},"recordHash":"7536659cf0da194099093b9fa11a8e5e8fbd4f64bdcc498b3bb079ac220ac25d"}
{"body":{"formatVersion":1,"sessionId":"11111111-1111-4111-8111-111111111111","logEpoch":"22222222-2222-4222-8222-222222222222","seq":3,"eventId":"event_factory_failure","time":"2026-10-28T12:00:00Z","type":"execution/failed","executionId":"exec_demo_1","prevHash":"7536659cf0da194099093b9fa11a8e5e8fbd4f64bdcc498b3bb079ac220ac25d","payload":{"reason":"execution_factory_failed","cleanupComplete":true}},"recordHash":"1b483baf4604e3b21881478cefd7d629a7a45200c2dc3a206675ec30949fa40c"}
~~~

</details>

这是新增SessionJournal格式，不是原版DeepSeek的events.jsonl线格式，也不是当前后台MemoryLog直接序列化结果。需要新版本和独立解码器，不能给旧文件加几个字段后仍冒称兼容。

## 7．锁文件、半行日志与重启恢复

### 锁文件保留，内核锁会释放

打开固定events.jsonl.lock → 取得非阻塞独占flock → 在整个Host写入期间持有原FD → 等写者、读者和IO退出 → 解除锁并关闭FD。禁止unlink／rename锁文件；否则旧进程锁着旧inode，新进程可能锁到同名新文件，形成两个写者。

因此这里与教程wx存在标记不同：干净关闭后锁文件仍在，但内核锁已释放；崩溃后内核也会释放。另一个进程能否打开看flock结果，不看文件是否存在，不靠PID文件判断。锁FD设close-on-exec，不传给工具子进程。

### 打开流程固定为一条

~~~mermaid
sequenceDiagram
    participant U as 调用方
    participant M as AgentManager
    participant F as FileSessionStore
    participant D as 磁盘
    participant H as ConversationHost
    U->>M: Open(sessionId)
    M->>M: 同ID并发Open合并，已有则复用
    M->>F: Open并校验租户
    F->>D: 打开固定lock文件，取得flock
    F->>D: 核验header、连续记录、Hash和checkpoint
    F->>F: 核验完整封套；未闭合Execution只读显示未知
    F->>D: 按合同处置未确认半行／索引，不补业务终态
    F-->>M: Journal与确认Head
    M->>H: 重建元信息与历史投影，不恢复执行权
    M-->>U: 返回idle的Host
    Note over H,D: 不恢复旧调用栈、Owner、工具进程或自动执行资格
~~~

| 磁盘情况 | 固定处理 |
| --- | --- |
| 日志与checkpoint一致 | 重放到该前沿后打开。 |
| checkpoint后有完整合法行 | 验证整条链，补Flush并推进checkpoint；不重复追加同EventID。 |
| checkpoint之后只有末尾未完成半行 | 取锁后截断该未确认尾部，再耐久化恢复；不删已确认记录。 |
| 中间坏行、完整行坏Hash、跳号 | 报损坏并停止自动写，不跳过继续。 |
| checkpoint超出日志、已确认范围损坏 | 停止自动恢复，不把head倒退假装成功。 |
| 已有日志但header丢失／身份不明 | 不猜租户／会话／格式，不自动认领。 |
| 旧Execution没有终态 | 只读视图显示中断／未知和覆盖缺口；重开不补终态、不自动重做模型／工具／Check。 |

资源合同需配置maxRecordBytes、maxSessionBytes、maxHostCacheBytes、maxArtifactBytes和订阅容量；原事件base64及外壳字节也计入记录上限。编码／Hash／写入共享一份有界源或流式writer，不为估算重新物化完整日志。

固定前沿读取只读到确认offsetBytes；每次分页限制条数和字节。打开可以扫描完整磁盘日志，但不能把完整日志无限留在内存；索引可重建，缓存和投影都要有容量上限。

## 8．原运行日志怎么进入长期会话：不能只监听Observer

当前后台Conversation自己创建MemoryLog，且一次执行结束后terminal会封闭。迁移应新增必要日志端口DurableLogAdapter，并深入原MemoryLog的最终统一写屏障；仅在Conversation构造处替换公开Append不够。当前公开Append拒绝message/committed，消息及finite等路径通过私有提交，最终seq、RecordedAt和完整载体容量在共同屏障才确定。Observer可能隔离异常或丢记录，不能成为权威持久日志入口。

每次原逻辑提交以runtime/commit完整封套写入SessionJournal。payload保存原合同版本、稳定commitId、事件数量和seq范围，以及每条原ConversationID／LogEpoch／seq／EventID、原始载体字节及摘要；原字节使用base64避免JSON重排。外层有自己的journalSeq，不重编号原EventRef、不重算旧审计Hash，也不把旧事件装成新合同事件。成组提交必须在同一有界封套里完整校验与原子可见，不能循环逐事件Append后让前半批先可见。

~~~text
普通／finite／消息提交均进入原最终写屏障
→ 验证协议、来源、前沿与容量，并预留原源／内存占额
→ 固定原EventID、seq、时间，经显式完整codec生成有界载体
→ DurableLogAdapter封装完整runtime/commit
→ SessionJournal耐久Append成功
→ 安装原内存事实／消息回执及投影
→ 发布已提交观察与UI订阅
~~~

完整原源须用现有受控codec与原owner借用，不能直接json.Marshal(Event)后base64；Recorded消息本就禁止这种普通导出。预留失败发生在磁盘之前，避免先持久后遇原容量拒绝。

记录已耐久后的安装不能因晚到ctx取消又被判成未写入。若本地安装／投影失败，封闭写入并按原EventID及固定前沿查证重建；不能重新分配身份再写一次。内存已改但磁盘还没成功的顺序禁止使用。必要记录失败与可选Debug／OTel失败必须是不同错误出口。

### 多次Execution如何连接messages

Host维护SessionProjectionV1与SeedManifest，两者属于新合同，不能直接把上一轮调试DTO当作完整历史。

| 种子来源 | 下一Execution怎么使用 | 怎样避免重复 |
| --- | --- | --- |
| 本次冻结system／业务上下文 | 当前Adapter组装并保存对应快照与证明 | 不把上次system当普通历史再带入。 |
| 已提交历史消息 | 在固定Session前沿下，有界借用完整角色、正文、工具调用与结果 | SeedManifest逐项指回原Session消息身份，重播时不重新产生历史节点。 |
| 本次人类输入 | 来源为execution/accepted的稳定输入身份 | 同RequestID重复提交不重复播种。 |
| 本次模型、工具及可信纠错 | 仅由已确认的原message/committed及原来源合同产生 | Session投影识别新消息，不从工具开始或失败Attempt造消息。 |

上一Execution中已提交的工具往返、候选和可信纠错属于可审计历史；控制日志不自动变消息。保留它们并不授予新执行工具权。读取历史证据仍须校验当前租户和Workspace范围；权限收回后不允许因旧消息存在而继续向模型发送受限内容。

第一版不在这里实现压缩或surface replace。超出输入窗口、缓存或历史加载预算时明确拒绝本次提交并给出可操作原因，不能静默删消息、截断JSON、拆开工具对。后续压缩须单独定义有效消息、来源覆盖、Hash／版本、容量和恢复合同。

## 9．一次提交、取消和等待的固定流程

~~~mermaid
sequenceDiagram
    participant U as API／客户端
    participant H as ConversationHost与长期Driver
    participant J as SessionJournal
    participant F as ExecutionFactory
    participant E as 本次Driver／中立Runner
    participant B as Host外业务协调器
    participant P as PG正式业务仓储
    U->>H: Submit(requestId、输入、可信绑定)
    H->>H: 幂等、当前无Execution、权限和预算准入
    H->>J: execution/accepted，耐久确认
    J-->>H: Accepted Head
    H-->>U: RunRef
    H->>F: 新建Execution与资源Owner
    F-->>H: 本次执行单元
    H->>J: execution/started，耐久确认
    H->>E: 运行，按固定前沿有界播种
    E->>J: 必要runtime/commit同步耐久
    B->>P: 注入的业务审计桥在模型调用中确认原Start／Finish
    E-->>B: 候选来源与读取租约，awaiting_business
    Note over E,B: 同一次Do仍在运行；Check不进入Host／Runner
    B->>B: Parse／Schema／Check，确认业务决定
    opt 允许纠错且原剩余额度足够
        B->>J: 通过唯一消息提交入口确认普通反馈
        B->>E: 同Do、同Owner继续新Turn
        E-->>B: 下一候选来源
    end
    B->>P: 按原业务规则确认正式结果／失败事实
    B-->>E: 可信回调实际完成
    E-->>H: 整个Do结束及真实执行终态
    H->>H: 等Driver／写者／任务资源真实退出
    H->>J: execution终态及结果索引，耐久确认
    H-->>U: Wait返回Result和产物引用
    Note over H,F: Submit重复请求不重复运行；本次Context超时不代表远端已撤销
~~~

耐久accepted之后若ExecutionFactory失败，按原成功绑定规则清理部分资源，记录failed终态；若execution/started写入失败，禁止启动并清理已申请资源，Host进入unavailable。必要失败终态也无法落盘时，Wait返回持久化不明／待对账，不永久假装accepted，也不自动重做Submit。

一个Host只允许一个Execution。Submit的Context控制接收等待，不能把HTTP断线解释成自动取消后台执行；Interrupt显式针对ExecutionID，避免取消错了后续执行。

Interrupt先触发原取消信号，再记录cancel_requested。磁盘满也不能阻止停止请求。Wait调用者超时只停止本次等待；后台仍按原期限、取消和审计合同收尾，重新Wait同ExecutionID可读其状态。

错误出口至少闭合为SESSION_BUSY、SESSION_CLOSING、REQUEST_CONFLICT、VERSION_UNSUPPORTED、JOURNAL_CORRUPTED、PERSISTENCE_UNCERTAIN、STORE_UNAVAILABLE、CONTEXT_LIMIT_EXCEEDED和ARTIFACT_INVALID等；与原业务稳定码分开映射，不能将必要写盘失败降为调试warning。

执行状态包括accepted／running／awaiting_business，以及succeeded／failed／cancelled／interrupted／reconciliation_required终止或待核状态。Host状态则是loading／idle／running／closing／closed／unavailable。业务Accept／Repair／Stop仅属于Host外协调器；不能成为Host状态或Runner输入。只读恢复视图中的interrupted／unknown标记不自动制造已提交终态事件。

## 10．大JSON结果怎么取：原版Goal对照与可选文件交付

### 原版DeepSeek实际提供什么

原版GoalSnapshot只有id、revision、objective、phase、blockedReason和maxGoalRounds等目标状态；GoalView另有轮数／时间／activation。complete(agent, ref)不接收结果正文，因此不存在“get_goal拿回报告JSON”的内置接口。

若Agent直接在assistant正文输出JSON，就从对应assistant/message的文本读取，再解析与校验；流式delta不是最终完整结果。若Agent用write写文件，程序读取该文件。若工具结果太长，spill-policy可能保存完整工具文本，模型只看到预览／定位信息；它不自动处理assistant产出的JSON。Spill的预览往往不是合法完整JSON，不能对预览直接JSON.parse得到原报告。

### 大文件交付的附加设计，不改变TAMS正式结果入口

TAMS本期正式结果仍由原业务收据及PG读取端口交付。下列ArtifactStore、结果索引与HTTP下载是为需要独立完整文件的应用补充的方案；不是架构v7／D8已经实现或必须新增的能力，也不要求让只读证据Agent获得写文件工具。评估场景由可信业务层从已确认结果导出；通用编码Agent场景才可由受控产物工具提交文件。

~~~text
可信业务层导出已确认结果，或受控产物工具提交报告
→ 写Store私有暂存文件
→ 关闭全部写句柄并封口，使暂存内容不可再变
→ 文件层校验格式与容量；业务层校验Schema、证据／Check
→ ArtifactStore对同一内容计算实际字节与SHA256
→ fsync文件、无覆盖地发布不可变artifact文件、fsync目录
→ SessionJournal耐久记录artifact/committed
→ 已有正式结果只关联其原收据，不为导出文件重提交业务
→ 记录可核验的artifact索引和可用覆盖状态
→ 调用方按结果索引读取完整artifact
~~~

原版模型调用update_goal complete本质上是状态声明；它本身不校验大文件。通用编码应用若要求“完成一定带合法报告”，需有可信提交策略验证。TAMS不引入Goal来做这件事，Parse／Schema／Check继续在Host外；文件层和通用核心不导入评分Schema或执行Check。

FileArtifactStore只接受服务端分配的ArtifactID和受控暂存句柄，不接受模型给的任意宿主路径。默认由受控产物工具写入Store自己拥有的暂存句柄，写者退出后封口。若导入原write工作文件，先要求完成写入与固定版本的可信收据，再无符号链接地复制到Store私有暂存并封口；仅打开旧路径再验证随后rename，不能防止其他写者改内容。验证、Hash和发布都基于同一封口对象；无法证明版本稳定则拒绝导入。仅在assistant里说“已写好report.json”不算提交。

完整文件保存在artifacts，events.jsonl保存文件元数据和关联。这里不删减本来必须保存的原模型候选／消息正文源；导出产物不能反过来成为事件正文缺失的借口。元数据至少有SessionID、ExecutionID、ArtifactID、locator、bytes、SHA256和mediaType；业务Schema／验证收据在业务结果关联中解释，不塞进通用文件接口。文件名和locator由Store返回，不能拼一个假定路径当真实结果。

下面示例为了展示完整字节而缩成两项；大报告遵守同一取法。示例Hash根据实际UTF-8紧凑JSON计算，均为新设计数据，不是原版API返回。

<details>
<summary>展开artifacts/artifact_demo_1.json的完整教学正文</summary>

~~~json
{"score":1,"items":[{"reference":"ref_1","passed":true,"reason":"客服说明处理时限。"},{"reference":"ref_2","passed":true,"reason":"客服给出了后续联系渠道。"}]}
~~~

</details>

字节数和摘要按上面这一行UTF-8内容计算，不含围栏和末尾换行；重新缩进或添加换行会改变文件字节与Hash。

<details>
<summary>展开调用方取得的完整结果索引</summary>

~~~json
{
  "sessionId": "11111111-1111-4111-8111-111111111111",
  "executionId": "exec_demo_2",
  "status": "succeeded",
  "businessReceiptRef": "receipt_demo_2",
  "artifacts": [
    {
      "id": "artifact_demo_1",
      "locator": "artifacts/artifact_demo_1.json",
      "bytes": 180,
      "sha256": "20edfe344d7777e59c7f5d6da6885a065017ad85073ee0e6c3e6e9cd55a4d3b8",
      "mediaType": "application/json",
      "schemaRef": "report_schema_demo_v1",
      "validationReceiptRef": "validation_demo_1"
    }
  ]
}
~~~

</details>

调用方的固定操作：先按ExecutionID取Result → 检查终态／正式收据／产物验证 → 使用返回的ArtifactID读取文件 → 核验实际大小与摘要 → 按业务需要解析。大文件下载可以流式传输，不要求先把全文放进浏览器或模型上下文。

拟新增接口映射如下，**这些不是原版DeepSeek现成API**：

| 目标API | 输入 | 返回什么 |
| --- | --- | --- |
| GET /sessions/{id}/executions/{executionId}/result | 可信用户及两个身份 | 执行状态、正式收据、产物元数据；不会返回全部JSON全文。 |
| GET /sessions/{id}/artifacts/{artifactId} | 可信用户及产物身份 | application/json文件字节，可流式下载；校验归属，拒绝任意路径。 |
| GET /sessions/{id}/results | 执行身份及可信用户 | 已提交文件结果列表，按明确版本取，不猜最后一条assistant。 |

大JSON的存储上限和验证上限必须在配置中明确。业务Schema可流式检查的数组逐项验证；需要全量语义的规则先申请有界内存。超限或不支持的验证明确失败，不删数据后声称通过。仅凭JSON语法合法也不能跳过证据或业务Gate。

Spill用于控制模型看到的工具输出大小；ArtifactStore用于交付完整业务产物。前者可能有短期清理政策，不能直接把一个会过期的Spill路径当长期正式结果。模型只需要结果摘要和artifact引用时，也不应再次把完整大JSON塞回下一轮messages。

### 产物写入的三个失败窗口

| 失败时机 | 恢复动作 |
| --- | --- |
| 暂存文件写到一半 | 未提交，不出现在Result；按暂存清理政策处理。 |
| 文件已提交但artifact事件未确认 | 暂不对外宣布产物可用；按ArtifactID／摘要查证补索引，不重新生成报告。 |
| PG结果已确认但文件结果索引未确认 | 从正式收据补文件投影，不再调用模型或重复提交业务。 |

## 11．PG和磁盘各自权威，沿既有端口核对缺口

FileSessionStore是会话历史的权威；PG是Run、阶段Attempt、Lease、Start／Finish、409阻断和正式结果的权威。file fsync与PG事务不能组成一个本地事务。

按最新D8-F，复用既有PG读取、错误及恢复端口，不新增SessionReceiptOutbox或PG表／字段来为会话存储建第二本账。业务层关联Session／Execution与原tenant／Run／Attempt／stage／CallID，按原身份查询已经确认的正式事实；通用Store不导入业务判定类型。

PG成功而文件追加失败时，保留PG事实并在查询结果显示记录缺口；补日志只能依据可核验的原收据，不得重新调用模型、Check或重复提交结果。文件中存在完成文字但PG未确认时，不向外声称正式业务成功，也不据此授予新Attempt。无法得到所需原件／关联时明确缺失，不猜最新一份文件顶替。

只读Open／查询不补业务终态；若既有恢复合同明确授权记录核对结果，仍经同一Host／Journal写入口和跨进程锁，用原稳定身份幂等确认。无授权则只展示缺口。本设计不承诺“任何情况下自动修齐所有日志”，也不要求为存储新增调度器。文件产物与正式收据的绑定必须可核验；所需身份不存在于现有结果端口时，该附加产物能力暂不开放，而不是擅自增加PG迁移。

已确认409即使缺少磁盘镜像，Worker／Recovery仍从PG读取并阻断所有自动绕行。只有Start没有可信Finish的旧调用保持unknown；符合原合同的新业务Attempt资格仍保留，不能为这次改造全局禁用或扩大恢复。

## 12．关闭：Execution、Host、应用分三层

~~~text
一次Execution结束
  等原Driver.Done（含直接Gate／业务报告）
  → 等运行写者
  → Conversation.PrepareClose冻结最终前沿
  → 必要记录耐久化，或明确记录失败出口
  → 确认必要材料与采集覆盖／缺失状态
  → 原Conversation关闭并等读者
  → 任务工具／工厂／Guard／Cleanup关闭
  → 归还本次Owner
  → Owner已归还、Journal可写、必要投影／终态完整时才恢复idle

ConversationHost.Close
  禁止新Submit
  → 取消并等当前Execution真实清理
  → 撤销Host订阅、停止读取／追加
  → 必要日志与结果索引Flush
  → Journal IO退出并释放锁FD
  → 从Manager索引移除
  → 磁盘会话与产物保留

应用停机
  停止业务Worker与所有新准入
  → Manager关闭全部Host
  → 关闭全局ArtifactStore／SessionStore
  → 关闭共享业务连接与Pool等
  → 最后Flush／Shutdown OTel
~~~

如果必要持久化失败，不可以返回“可恢复成功”，但仍应取消、等待真实退出并释放已归还句柄；不能为磁盘故障无限保活模型与工具。Journal自身若还有实际IO则仍不能伪报已关。

Close等待超时返回pending，同一个继续者继续收尾，不新建Cleanup窗口，也不释放在用Owner。独立MemoryDebugStore及关闭时整段Seal复制在查询、材料和缺失语义替代齐备后删除；必要正文不可因调试缓存过期丢失。仍须等真实业务退出，不能因取消信号已发就释放文件写锁，让第二个Host进入。

Owner仍in_use时Host保持收尾态，不启动第二个Execution；Journal或必要投影不可用时Host进入unavailable，拒绝新Submit。

关闭Host、删除会话、删除产物分别是不同操作。本期不新增自动删除用户数据；后续删除需定义引用、权限、保留期及任务在途条件。

## 13．拟建文件与现有代码迁移映射

以下路径是TAMS后台拟建／拟改路径，不是本教材仓库已新增的源码文件。不能把下表“目标文件”写成已交付代码。

| 目标路径 | 放什么 | 从现有哪里迁移／复用 |
| --- | --- | --- |
| internal/agentmanager/manager.go | 长期Host索引、并发Open合并、数量限制、应用关闭 | 当前app.AgentGoalManager的准入／索引职责；不建第二个物理Pool。 |
| internal/agentmanager/host.go | Submit／Interrupt／Wait、Host状态与Journal借用 | 新增长期外壳；现有一次性task不是直接改名。 |
| internal/agentmanager/driver.go | 一个Host内串行运行Execution | 包装原AgentDriver，不重置原terminal。 |
| internal/agentmanager/lifecycle.go | Host卸载与会话FD／订阅退出 | 原Execution生命周期留在适配器。 |
| internal/agentmanager/shared.go | SharedServices只读依赖与拥有权 | 当前AgentRuntime、Pool、观察池、客户端与资源解析端口。 |
| internal/sessionstore/contracts.go | Header、Head、记录、幂等和错误合同 | 新增版本化合同。 |
| internal/sessionstore/file_store.go | Create／Open／List、路径与身份 | 教程041只作行为参考，不能照搬wx锁。 |
| internal/sessionstore/journal.go | 完整追加、短写、fsync、checkpoint | 新增耐久记录实现。 |
| internal/sessionstore/lock_unix.go | 固定inode、flock、close-on-exec | 第一版Linux／macOS；其他平台拒绝启动或另交实现。 |
| internal/sessionstore/recover.go | 核验链、半行、checkpoint、旧Execution中断 | 不自动重做外部调用。 |
| internal/sessionstore/native_log.go | 原事件字节与身份的同步耐久接缝 | 构造注入并改造原eventlog／event_message共享的最终写屏障，覆盖消息和finite路径。 |
| internal/sessionstore/projection.go | SessionProjectionV1与SeedManifest | 复用现有原事件／消息解释，不自己解析正文工具信封。 |
| internal/artifactstore/file_store.go | 暂存、校验句柄、不可变发布与授权读取 | 新增完整业务产物能力；不改Spill含义。 |
| internal/evaluationmodel/stage_coordinator.go | Host外的完整业务回调、冻结绑定、Check／反馈幂等 | 原Check迁出Goal／核心；每原Core任务一次Do，保原任务及共享工具边界。 |
| internal/sessionquery/service.go | 固定前沿只读查询、调试投影与覆盖状态 | 替代MemoryDebugStore；不创建Host／Workspace或新执行。 |
| internal/sessionstore/materials.go | 按需持久材料与采集缺失语义 | 不把日志没有的旧失败现场伪装为已采集。 |
| internal/app/agent_manager.go | 应用唯一装配与停机 | 替换分散装配，注入同一SharedServices。 |

llmchat、Host外业务Check与R01～R03仍沿原TAMS计划实施；这里不复制其HTTP和业务规则。目录位置可以因Go内部包依赖作等价调整，职责和单一拥有权不可变。

## 14．沿原施工包细化成一条顺序，每步有验收

M编号只是本稿的文件实现细分，不替代实施v10的D3／D6／D8或V18～V22。先固定共同合同，再按下表依赖施工；业务闭环、只读恢复、跨Execution准入分别验收。Artifact扩展单列验收，不阻塞本期TAMS直调。

| 步骤 | 实施内容 | 这一步的验收 |
| --- | --- | --- |
| M00 | 对齐架构v7／方案v12／实施v10的D8-A～F，固定本稿封套提案与原合同关系 | 不带活动Goal、不保留独立MemoryDebugStore、不新增会话收据PG账本；附加产物单独标记。 |
| M01 | 抽出SharedServices与ExecutionFactory，保持旧外层行为 | 仍只有一个物理Pool／Observer；原任务只执行一次，全部旧所有权门禁通过。 |
| M02 | 实现FileSessionStore创建／锁／Append／checkpoint | 两进程同Session只有一方能写；同ID同内容幂等、冲突拒绝。 |
| M03 | 实现损坏检测与恢复 | 半行、header落后／领先、fsync失败、回执丢失均有确定结果。 |
| M04 | 按D8-B把必要原提交接入DurableLogAdapter | 普通／finite／成组消息先预留并固定身份再耐久；批次原子可见，原EventRef／原源不变；Observer故障不影响正确性。 |
| M05 | 按D8-A/E实现Host、同Do候选等待和业务反馈续跑，再开放合法新Execution | 同任务Repair不新建Owner／预算；E1真退出后合法新任务可E2，同四元任务键换ID仍拒绝重领。 |
| M06 | 实现SessionProjectionV1和固定前沿SeedManifest | 卸载重开、进程重启后下一请求消息等价；工具ID配对、不带旧system双份。 |
| M07 | 按D8-F复用既有PG读取／恢复核对会话缺口 | 不新增PG表／字段；只读重开零副作用；409仍阻断，unknown合法恢复规则保留。 |
| M08 | 独立扩展：可信业务导出Artifact与结果索引 | 文件完整、摘要一致、业务验证保持原层；不为导出重提交业务，不成为D8本期前置条件。 |
| M09 | 应用API调用Manager／Host，SessionQuery接只读历史；ACP／文件下载按扩展范围接入 | 相同核心入口不双执行；查询不创建Host或新任务，协议扩展不成为TAMS本期门禁。 |
| M10 | 按D8-D接SessionQuery／Materials、现有OTel和订阅 | 必要来源与缺失语义替代后移除独立DebugStore／Seal；不上传完整报告或凭据。 |
| M11 | 故障、容量、关闭与同版全量验收 | 下节场景逐项有真实证据；上线同时满足原TAMS真实模型／发布与历史门禁。 |

第一阶段目标是“新结构下行为不退化”，其后才有耐久恢复；完整文件交付是独立扩展。原计划D3／D6／D8及真实发布条件仍分别满足；不能把M02能写文件当作可恢复Agent已完成，也不能拿M08给本期扩围。

## 15．必须覆盖的失败场景与完成条件

| 稳定复现场景 | 正确结果 |
| --- | --- |
| 同进程并发Open十次 | 只创建一个Host／Journal；失败的等待者不清理胜出的实例。 |
| 两进程同Session抢锁 | 仅一个写者；未取得锁不能追加，也不能unlink锁文件抢占。 |
| 进程持锁时启动工具子进程，再退出父进程 | 工具不继承锁FD，不会让会话永久占用。 |
| 会话目录发布后、父目录fsync前注入崩溃 | 未完成Create成功回执；重新核验目录，不许凭缓存承诺已持久。 |
| 在每个Append屏障前后注入崩溃 | 依据完整commit与校验恢复，checkpoint只作索引；成组消息不半批可见。 |
| 短写／磁盘满／fsync失败 | 无假成功；Journal停止新追加，按原EventID对账。 |
| 成功回执丢失后重复Submit／Append | 取回原身份与收据，不开第二个Execution或新物理调用。 |
| 耐久事件成功、投影安装失败 | 从原前沿补投影，不重复事件，不继续使用旧视图。 |
| 模型请求或工具开始后进程退出 | 重开不发送、不Check、不补终态；显示unknown及覆盖缺口，必要核对沿既有端口。 |
| PG确认409后文件写失败／Worker退出 | PG仍决定阻断；文件缺口不借新ID绕过。 |
| Host空闲保持十分钟 | 不占执行Owner／工具进程／模型缓冲；缓存受限。 |
| Host.Close时业务Check仍持有工具 | Close可pending，但Owner／共享服务／文件写锁不提前释放。 |
| 同任务换Session／Execution提交，另有合法新任务提交 | 同四元TaskKey不能重领；合法E2等E1清理后用自身读取租约读原历史，旧terminal不重置。 |
| 产物文件写完、索引前崩溃 | 恢复查证同ArtifactID并补索引，不重新生成。 |
| 附加产物完成声明指向不存在／坏JSON／错误Schema文件 | 拒绝该文件交付；业务验证留Host外，不把正式PG结果改造成假文件。 |
| 对账传入同Execution的其他产物，或原收据／产物已过期 | 拒绝错配／过期引用，不选最新文件顶替原结果。 |
| 客户端下载其他租户ArtifactID或提交../路径 | 读取／导入拒绝，不暴露宿主文件。 |
| Spill文件过期 | 不影响独立提交的正式产物；不能把Spill视作永久Artifact。 |
| Collector不可用／队列满 | 必要日志与PG仍独立；有限遥测允许丢失，不能无限积压。 |

设计完成不等于代码完成。后续实现应保留每步提交、测试层次和运行证据；单元、受控HTTP、隔离磁盘进程、PG／Redis、真实模型分别列清，SKIP不算通过。本轮没有修改后台、数据库或两份外部方案，没有收费调用，也没有自动提交。

## 16．核对入口

- [前一份现状与TAMS约束核对](/Users/yhding/ws/github.com/deepseek-harness-demo/reference/agent-host-tams-complete-architecture.md)：当前实现、源码摘要、三层边界与四层重试。
- [TAMS架构v7](/Users/yhding/ws/echo-tech/web-agent-all/design/feishu-session-evaluation/08-T03-agent-runtime-decoupled-architecture.md:3)：Host外Check、中立Runner、持久会话和共享资源的当前目标。
- [TAMS方案v12](/Users/yhding/ws/echo-tech/web-agent-all/design/feishu-session-evaluation/08-T03-tams-llm-direct-replacement-plan.md:3)：完整存储已经纳入，不沿用旧v5活动Goal解释。
- [TAMS实施v10](/Users/yhding/ws/echo-tech/web-agent-all/design/feishu-session-evaluation/08-T03-tams-llm-direct-replacement-implementation-plan.md:3)：D8-A～F及V18～V22为原施工和验收入口。
- [当前Conversation一次性准入](/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/conversation/run.go:12)：为什么新增长期外壳而不是重置旧运行对象。
- [原消息提交特殊路径](/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/agentloop/event_message.go:108)：DurableLog不能漏掉message/committed。
- [原最终序号与容量屏障](/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/agentloop/eventlog.go:435)：预留、固定身份、codec与耐久的实际接缝。
- [当前内存日志构造](/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/conversation/conversation.go:132)：DurableLogAdapter必须接入的真实位置。
- [当前生命周期退出](/Users/yhding/ws/echo-tech/qdmp-workspace-admin-backend/internal/app/agent_lifecycle.go:254)：继续保留完整Driver、写者、读者与资源退出顺序。
- [原版Goal状态字段](/Users/yhding/ws/github.com/deepseek-harness-demo/deepseek-harness/packages/goal/goal/src/types.ts:60)：无报告正文或result字段。
- [原版complete方法](/Users/yhding/ws/github.com/deepseek-harness-demo/deepseek-harness/packages/goal/goal/src/index.ts:391)：只改变目标状态，不接收产物。
- [原版Spill策略入口](/Users/yhding/ws/github.com/deepseek-harness-demo/deepseek-harness/packages/spill/spill-policy/src/index.ts:133)：处理工具结果／日志，不自动处理assistant全文。
- [原版请求配置与工具Schema](/Users/yhding/ws/github.com/deepseek-harness-demo/deepseek-harness/packages/core/session/src/types.ts:234)：request/header与system/message各存什么。
- [原版提示词提交](/Users/yhding/ws/github.com/deepseek-harness-demo/deepseek-harness/packages/core/agent-loop/src/agent.ts:423)：渲染后的正文进入会话。
- [原版请求快照变更](/Users/yhding/ws/github.com/deepseek-harness-demo/deepseek-harness/packages/core/agent-loop/src/agent.ts:637)：initial／resume／change／series，并非整个会话永远不变。
- [原版Skill加载](/Users/yhding/ws/github.com/deepseek-harness-demo/deepseek-harness/packages/skill/tool-skill/src/index.ts:128)：已加载正文与完整资源版本包的区别。
- [原版MCP注册映射](/Users/yhding/ws/github.com/deepseek-harness-demo/deepseek-harness/packages/mcp/mcp-client/src/tools.ts:118)：工具公开名、原始名与调用闭包。

原版DeepSeek本地读取提交为687f282e，包含工作树改动时以实际文件为准。本文接口、SessionJournal格式、ArtifactStore与API均明确为目标设计；本轮只验证文档与独立类型／示例，不声称后台已支持。
