# 023补充：从单选弹窗到调用方继续执行

返回[023 · 一次审批只唤醒一次调用](../lessons/023.md)。本教程在Approvals基础上增加一个独立问答实验：用本机页面实际回答问题，观察原来停在await处的函数继续执行。示例没有调用模型、没有接真实Host，也不改变023基础测试。

## 1. 先确定需要哪种用户交互

| 类型 | 例子 | 合法答案 | 领域含义 |
| --- | --- | --- | --- |
| 操作审批 | 是否允许执行命令？ | 允许／拒绝 | 能否执行某个动作 |
| 单选问答 | 使用哪种数据库？ | 一个选项ID | 收集用户偏好或缺失信息 |
| 多选问答 | 需要哪些功能？ | 选项ID数组 | 收集多个选择 |
| 文本问答 | 项目名称是什么？ | 字符串 | 收集自由输入 |

“弹窗”是页面展示方式，不是领域类型。服务端必须知道这是单选、多选还是文本，并验证答案；不能让前端决定答案是否有效。取消问答返回cancelled，超时返回timed_out，任务中止通过AbortSignal抛错，都不能假装用户选择了某项。也不能用用户回答某选项代替执行命令的权限许可。

## 2. 先看目录和调用关系

```text
examples/023-questions/
├── questions.mjs       # Questions登记簿：等待、校验、回答、取消与超时
├── server.mjs          # Bun HTTP入口，启动演示任务
├── index.html          # 原生dialog；单选radio、多选checkbox、文本input
└── questions.test.mjs  # 生命周期测试与真实HTTP集成测试
```

完整源码：[Questions](../examples/023-questions/questions.mjs)、[本机服务](../examples/023-questions/server.mjs)、[页面](../examples/023-questions/index.html)、[测试](../examples/023-questions/questions.test.mjs)。这些是补充实验文件，已经有中文注释；没有把它们加入累计工程的Agent工具表。

```mermaid
flowchart TD
    Start[页面点击单选、多选或文本按钮] --> Task[HTTP启动runTask]
    Task --> Q[Questions.request先登记pending]
    Q --> Wait[runTask暂停在await]
    Q --> State[发布question/request，保存演示状态]
    State --> Dialog[页面轮询state并打开dialog]
    Dialog --> Answer[POST答案，携带问题ID]
    Answer --> Check[服务端检查归属、类型和选项]
    Check -->|合法| Finish[删除pending，清理计时器和监听]
    Check -->|非法| Retry[保留原问题，页面显示错误]
    Retry --> Dialog
    Finish --> Continue[resolve答案，runTask继续]
```

## 3. 直接运行，看到真实弹窗

需要本机已有Bun，不需要安装第三方依赖。在仓库根目录执行：

```sh
bun tutorial/linear/examples/023-questions/server.mjs
```

复制终端打印的本次http://127.0.0.1:端口地址，在浏览器打开。不要直接打开静态index.html，也不要在GitHub Pages上期待这个示例启动Bun服务。

1. 点击“单选问答”，选择SQLite并提交，页面结果应为status:answered、value:sqlite。
2. 点击“多选问答”，勾选两个选项，结果value应是数组。
3. 点击“文本问答”，输入项目名称并提交，结果value是字符串。
4. 再启动一个问题，点“取消问答”或按Escape，结果为cancelled，调用方结束等待并决定后续动作。
5. 超过默认两分钟不答，结果为timed_out；需要观察快速超时，用测试中的短预算。
6. 在没有弹窗阻挡时可点击“取消整个任务”；自动测试直接验证任务AbortSignal中止。模态弹窗打开时，外层按钮不可点击，这是dialog的正常行为。
7. 终端Ctrl+C退出。服务先中止等待，再关闭监听；演示数据仅在内存，重启不会恢复问题。

原生dialog的关闭按钮或Escape必须通知服务端结算。只让弹窗消失、不取消服务端等待，会留下一个迟迟不结束的任务。

## 4. 结构化问题和答案

```javascript
// 问题结构：使用稳定ID回传，显示标签可以单独调整。
const question = {
  kind: 'single',
  title: '选择数据库',
  options: [
    { id: 'sqlite', label: 'SQLite' },
    { id: 'postgres', label: 'PostgreSQL' },
  ],
}

// 用户选择的答案，与审批boolean保持分离。
const answer = { status: 'answered', value: 'sqlite' }
```

调用方使用await等待结果。示例server.mjs的runTask执行的就是这条路径：

```javascript
// questions和signal由任务拥有者提供；这里展示接入方式。
const answer = await questions.request(owner, question, signal)

// 只有answered才是用户给出的有效信息。
if (answer.status === 'answered') {
  console.log('用户选择：', answer.value)
} else {
  console.log('没有获得答案：', answer.status)
}
```

问题ID用于回答“是哪一次问题”；owner用于回答“属于哪个会话”。演示服务固定为demo-session，不接受浏览器随意指定owner。实际产品必须通过已有认证与会话权限取得owner，不能相信请求正文里的身份。

## 5. 等待与结算时序

```mermaid
sequenceDiagram
    participant T as 任务runTask
    participant Q as Questions
    participant H as 本机HTTP服务
    participant P as 浏览器dialog
    T->>Q: request(owner, question, signal)
    Q->>Q: 登记ID、pending、超时、取消监听
    Q->>H: question/request
    H-->>P: GET /state返回问题
    Note over T,Q: T停在await，服务仍可接收其他HTTP请求
    P->>H: POST /answer，问题ID与结构化答案
    H->>Q: 使用服务端确定的owner调用answer
    Q->>Q: 校验身份、答案类型与选项ID
    alt 合法答案
        Q->>Q: 删除pending并清理等待资源
        Q->>H: question/settled
        Q-->>T: resolve answered与value
        T->>T: 继续处理任务
    else 非法或跨会话答案
        Q-->>H: 抛错，不消费原问题
        H-->>P: 错误信息，允许重新选择
    else 取消或超时
        Q->>Q: 一次性结算并清理
        Q-->>T: cancelled、timed_out或任务中止异常
    end
```

登记必须先于发布：如果publish回调立即答复，pending和清理函数应已经准备好。合法答复后先删除pending，再通知页面，旧页面或另一客户端的重复答复无法唤醒第二次。

## 6. 将来怎样接入真正的Agent

```mermaid
sequenceDiagram
    participant M as 模型
    participant L as Loop与Tools
    participant Q as 问答服务
    participant S as Session事件与Remote
    participant P as 页面弹窗
    M->>L: 调用ask_user工具
    L->>Q: await request，会话身份与取消信号
    Q->>S: 发布问题事件
    S-->>P: 推送问题与ID
    P->>S: 提交答案RPC
    S->>Q: 校验当前会话后answer
    Q-->>L: 结构化答案
    L->>S: 保存工具结果
    L->>M: 下一模型请求携带工具结果
    Note over M,P: 这是后续接线设计，当前独立示例没有实现这条模型链
```

接到现有工程时，需要增加ask_user工具、Host拥有的Questions实例、Remote回答方法、页面状态投影与弹窗，以及问题和回答事件的持久化。模型拿到的是工具结果，不需要把答案另塞一份进系统提示词。

Questions可以参考Approvals的一次性等待方式，但不能直接调用Approvals.answer传字符串：本章allowed === true会把字符串变成false。先把两条真实功能链跑通，再考虑提炼公共等待组件，比先设计通用框架更容易理解和验证。

## 7. 验证与调试

只运行这份补充实验的测试：

```sh
bun test ./tutorial/linear/examples/023-questions/questions.test.mjs
```

| 验证范围 | 观察点 |
| --- | --- |
| 单选与归属 | 错会话、未知选项拒绝，原问题仍可正确回答 |
| 多选与文本 | 多选拒绝重复ID，文本拒绝空白，答案保持原类型 |
| 取消与超时 | cancelled、timed_out、任务Abort不同，pending最终清空 |
| 发布边界 | 同步回答不丢失，发布失败清理等待 |
| 真实HTTP | 启动任务、接收答案、runTask继续、迟答拒绝 |

在VS Code仓库根目录的终端可以这样先等待附加：

```sh
bun --inspect-brk=127.0.0.1:6510/questions-023 tutorial/linear/examples/023-questions/server.mjs
```

使用Bun附加配置连接本次终端打印的完整ws地址，继续到“打开页面”后再开浏览器。先在questions.mjs的pending.set、answer校验和finish断点；再在server.mjs的await questions.request之后设断点。浏览器选择后，服务端先结算、再命中await之后。这里只给启动命令，不覆盖现有launch.json；023基础测试配置不会运行这份独立示例。长暂停会影响两分钟超时，观察后应继续并关闭服务。

## 8. 本示例的边界

这是本机单会话、内存状态、轮询页面的教学实验；问题不是模型生成，也没有接入现有Host、Journal或工具权限守卫。刷新页面可以重新看到当前未结算问题，但重启服务不能恢复。持久问答还需要定义重启时未答问题的恢复方式和迟答处理，不能只序列化Promise。生产接入还应补齐认证、输入大小限制、并发与连接故障策略。

固定原版分别提供[user-questions](../../../deepseek-harness/packages/interaction/user-questions/README.zh.md)与[tool-ask-user](../../../deepseek-harness/packages/interaction/tool-ask-user/README.zh.md)，本实验不是其完整协议复刻。

## 9. 持久问答：问题、回答、取消和超时怎样进入eventlog

本节以下内容是接入Journal时的设计教程，不是前面内存示例已经实现的行为。事件名是教程建议，不是固定原版协议。eventlog保存事实，pending中的Promise、resolve/reject、计时器和AbortSignal只属于当前进程，不能直接JSON序列化后恢复。

### 9.1 两类问答事件，加一条工具结果

建议使用question/asked记录问题，用question/settled统一记录四类结算，避免先写answered、再写settled造成两个事件之间的空隙：

| 事件 | 关键字段 | 作用 |
| --- | --- | --- |
| question/asked | questionId、toolCallId、turnId、owner、question、deadlineAt | 保存问题全文、稳定选项ID、所属会话、关联调用与绝对截止时间 |
| question/settled，status=answered | questionId、toolCallId、owner、value | 保存经服务端校验的结构化答案 |
| question/settled，status=cancelled | questionId、toolCallId、owner、reason | 保存取消问答，无答案值 |
| question/settled，status=timed_out | questionId、toolCallId、owner | 保存超时，无答案值 |
| question/settled，status=interrupted | questionId、toolCallId、owner、reason | 保存任务中止或重启后的中断处理 |
| message/tool | role、callId、name、content | Loop把调用结果交给后续模型请求 |

“用户取消问答”和“取消整个任务”分别用cancelled与interrupted表达。按钮取消不会自动授权工具，超时也不能默认选择第一项。以前示意的question/answered是另一种命名选择；本节统一使用question/settled加status，不要求两种格式同时写。

下面展示事件的type/data部分，实际外层format、sessionId、seq和time仍由Events.append生成：

```javascript
// 示例数据结构，不是给当前内存Questions增加一个publish回调就能完成持久化。
const asked = {
  type: 'question/asked',
  data: {
    questionId: 'question_123',
    toolCallId: 'call_456',
    turnId: 'turn_789',
    owner: 'session_owner',
    deadlineAt: 1900000120000, // 绝对毫秒时间示意，不能每次重启重新加两分钟。
    question: {
      kind: 'single',
      title: '选择数据库',
      options: [
        { id: 'sqlite', label: 'SQLite' },
        { id: 'postgres', label: 'PostgreSQL' },
      ],
    },
  },
}

// 单选值是ID，多选是ID数组，文本是字符串；都先校验再保存。
const answered = {
  type: 'question/settled',
  data: {
    questionId: 'question_123', toolCallId: 'call_456',
    owner: 'session_owner', status: 'answered', value: 'sqlite',
  },
}
```

owner不是信任浏览器发来的字符串，而是接入层依据会话权限确定的身份。服务端要用已记录的question验证答案，不用客户端随答案附带的选项替换原问题。

### 9.2 顺序：先写成功事实，再让用户或调用方看到成功

```mermaid
sequenceDiagram
    participant T as ask_user工具调用
    participant Q as 持久问答服务
    participant J as Events与Journal
    participant U as 页面
    participant L as Loop
    T->>Q: request问题、所属会话与取消信号
    Q->>Q: 登记本进程等待对象
    Q->>J: append question/asked，含deadlineAt
    J->>J: 追加JSONL并fsync
    J-->>U: 落盘成功后推送问题
    Note over T,Q: 原工具调用等待；问题正文已可从日志重建
    alt 用户提交有效答案
        U->>Q: questionId与结构化答案
        Q->>Q: 校验归属、选项、截止时间、未结算状态
        Q->>J: append settled，status为answered
    else 用户取消问答
        U->>Q: 取消指定questionId
        Q->>J: append settled，status为cancelled
    else 截止时间到达
        Q->>Q: 依据持久deadlineAt判断
        Q->>J: append settled，status为timed_out
    else 整个任务中止
        Q->>J: append settled，status为interrupted
    end
    J->>J: fsync结算事实
    J-->>Q: 确认已提交
    Q->>Q: 清理pending、计时器与取消监听
    Q-->>T: 返回状态或抛任务中止错误
    J-->>U: 更新问题状态并关闭旧卡
    T-->>L: 返回结构化结果，或交由错误路径处理
    L->>J: 写message/tool或相应工具失败结果
    Note over L,J: 取消任务时也可能直接结束回合，不保证一定再请求模型
```

这里的重点是：结算事件持久化成功后，才能确认HTTP/RPC答复成功、清除等待状态并唤醒调用者。页面重复提交、用户回答与计时器竞争，都必须在同一会话写入者中串行判定，只允许第一个合法终态提交。截止后才送达的答案不能因为计时器回调尚未运行而被接受；处理答案时也要比较deadlineAt。

对可能由发布监听器同步触发的重复回答，还要有“正在结算”保护，避免第一次append尚未返回时重入。单进程Map检查不等于多进程并发控制；本教程Journal的独占锁只是阻止两个写入者同时打开该日志，不提供分布式事务。

**不能把当前示例的publish直接换成写盘函数就宣称完成。** questions.mjs的finish先删除pending，而且会捕获结算publish异常后继续返回答案；这对内存展示容错适用，却不能保证结算落盘。持久版本需要单独的提交步骤，提交失败不得按成功继续。若写入或fsync失败导致提交状态不确定，应暂停该会话写入并重读确认，不盲目追加第二份答案。

### 9.3 message/tool与问答结算为何都需要

question/asked与question/settled用于恢复页面状态、审计和拒绝迟答；message/tool用于模型历史。它们关联同一次工具调用，但不是同一条记录：问答事件在这里命名为toolCallId，当前教程Loop的message/tool字段名实际是callId，值必须对应。不要把模型提供方协议里的tool_call_id误写成教程内部字段。

```javascript
// 回答已经持久提交后，工具返回值才可进入Loop的工具结果路径。
const result = { status: 'answered', value: 'sqlite' }

// 示意当前教程的模型消息结构；工具调用记录必须能关联同一个ID。
session.append('message/tool', {
  role: 'tool',
  callId: 'call_456',
  name: 'ask_user',
  content: result,
})
```

仅记录question/settled不会自动让模型看到答案：当前messages投影只接受message/user、message/assistant与message/tool。模型可见路径参考[031的Skill补充](../lessons/031.md)，同样要区分日志事实与请求消息。

## 10. 重启后恢复什么：先恢复状态，再决定怎样继续任务

### 10.1 从日志投影待答问题

重开会话后，先由Journal读取有效的完整事件，再按seq从前到后建立问题状态：遇到asked创建待答项；遇到settled将其改成终态。可保留已结算记录用于显示和审计，待答索引中只放尚未结算的问题。重复终态或引用不存在问题的结算应明确报告数据异常，不默默用后一条覆盖前一条。

恢复时检查原deadlineAt：已过期的未结算问题由拥有写权限的恢复流程追加timed_out事件，不能只在页面上隐藏；尚未过期才有资格按所选恢复策略继续。不要每次启动重新给完整等待时长。已回答、取消、超时和中断的问题，都不能再次作为新问题接受回答。

```mermaid
flowchart TD
    Start[重开持久会话] --> Read[Journal读取完整事件，检查序号]
    Read --> State[按asked与settled重建问题投影]
    State --> Ended{问题已经结算吗}
    Ended -->|是| Keep[保留终态，不重开原等待]
    Ended -->|否| Expired{原deadlineAt已过期吗}
    Expired -->|是| Timeout[追加timed_out并关闭旧问题]
    Expired -->|否| Policy{采用哪种恢复策略}
    Policy -->|本教程建议的初始方案| Interrupt[记录interrupted，旧轮次不自动继续]
    Policy -->|另行实现可恢复问答| Reattach[重建新等待对象，绑定原问题ID与剩余时间]
    Reattach --> Revalidate[验证会话、工具调用与轮次状态后，允许重新展示和答复]
```

### 10.2 第一版建议：中断旧调用，显式重新开始

当前041 Host发现未结束回合时会记录interrupted，且不自动重放工具；因此最容易与已有实现保持一致的方案是：先处理到期问题，其余未结算问题记录interrupted，页面显示“服务重启，原问题已中断”。用户明确继续后，由新一轮创建新问题ID，旧卡答案被拒绝。

这不等于恢复原任务，但能明确告诉用户发生了什么，也不把上次已经执行的其他工具再运行一遍。要采用“保持原问题等待”的策略，需要改变Host目前的恢复行为，不能只恢复Questions.pending就宣称支持。

### 10.3 进阶方案：可恢复问答需要显式续接，不是恢复旧Promise

若产品要求重启后继续原问题，需要把等待点设计成可恢复状态机：记录关联调用、轮次与截止时间；启动时重新创建等待对象并绑定原questionId；确认该工具调用仍被允许继续；答案提交后通过明确的恢复入口交给执行器。新的Promise可以承接新建立的等待，但旧进程中的函数调用栈已经不存在。

已经落盘的答案也不保证Loop来得及记录message/tool。必须检查关联工具结果是否已经提交，并按恢复协议补交或报告中断；不能只根据pending里没有记录就重新运行整个工具。

| 崩溃发生的位置 | 日志可能有什么 | 恢复时应判断什么 |
| --- | --- | --- |
| asked落盘前 | 没有问题事实 | 不显示一张仅在内存中出现过的旧卡 |
| asked落盘后、用户未回答 | 只有asked | 检查deadlineAt，再按中断或续接策略处理 |
| settled落盘后、旧Promise未唤醒 | 已有答案或其他终态 | 终态有效，不允许用户再回答，不依赖旧resolve是否执行 |
| answered落盘后、message/tool未落盘 | 有用户答案，无模型工具结果 | 通过明确恢复逻辑处理关联调用，不重放已有副作用 |
| message/tool已经落盘 | 问答终态与工具结果都有 | 不重复写结果、不重复注入答案，按Host恢复策略继续或中断 |

本方案中asked、settled和message/tool是不同提交，不假设存在跨事件原子事务。若恢复代码可能多次运行，需要用questionId与toolCallId检查已提交事实，并限制会话写入所有权；只靠前端隐藏按钮无法实现。

### 10.4 日志文件损坏、锁文件与“刷新页面”也要区分

浏览器刷新只丢页面内存，服务未退出时原Promise仍在；服务重启才需要重建投影和决定调用恢复。本实验仍是内存版本，实际运行它重启不会保留上述记录。

持久方案还依赖[006日志恢复](../lessons/006.md)：Journal只截断末尾无完整换行的残留，不自动修复中间坏行。崩溃可能留下独占锁文件，必须核实原写入者已经退出后再处理，不能为重开问答直接删除仍在使用的锁。

### 10.5 与原版事件语义的边界

本节question/asked与question/settled是建议格式。固定原版user-questions/tool-ask-user具有自己的工具结果和持续待答机制；正常同步回答可以进入工具结果，已转为持续待答问题的后续答案可由user/message、source.kind=user-question-reply及callId关联。不要把本节事件名、超时即关闭或重启中断策略套成原版现有协议。

本次新增内容没有给内存示例实现Journal、事件回放或进程崩溃测试；上文是下一步持久化设计与应补验收场景。后续实现至少应覆盖四种结算、迟答与竞争、两次重启不延长截止时间，以及“答案已落盘而工具结果未落盘”的故障窗口。
