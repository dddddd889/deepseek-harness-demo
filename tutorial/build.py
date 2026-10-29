#!/usr/bin/env python3
"""从已验证的逐步文件生成一份单线教程，保证文中代码与验收代码一致。"""
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parent

# 每一项都是唯一的下一步，练习只改变输入条件，不引出另一条实现路线。
LESSONS = [
('00', '在真正的空目录接收第一个任务',
 '不看示例，试着让一段 TypeScript 接收命令行文字。记下卡在建文件、参数还是启动命令。',
 '入口把用户文字变成程序输入。process.argv 前两项是运行时与脚本路径，后面才是任务。先验证输入和退出码，再接任何模型。',
 'bun run dev "读取 README，告诉我怎么启动"\nbun test tests/00-entry.test.ts\nbun run build\nbun dist/main.js "你好"',
 '源码和构建产物都输出“收到任务”；缺少参数时显示用法且退出码为 1。',
 'bun --inspect-brk src/main.ts "你好"', 'src/main.ts 的 prompt 赋值与 if 判断；先观察 process.argv，再逐句执行。',
 '运行 bun run dev，不传任务，随后单独运行 echo $?，应得到 1；恢复带任务命令后应得到 0。',
 '合上示例，写出“准备执行任务：……”的输出，并解释为什么 slice(2)。',
 '任务改成带空格的中文句子，仍然收到完整任务。'),
('01', '统一身份、事件和会话历史',
 '先画出用户任务、工具调用和输出各需要哪个 ID；不要先背类型名字。',
 'sessionId 表示一段会话，turnId 表示一次用户任务，seq 表示该会话事件顺序。messages 事件改变模型历史；text 事件用于显示正在到达的内容，暂时不等于可重放的完整 assistant 消息。',
 'bun test tests/01-session.test.ts\nbun test',
 '事件序号为 1、2，历史只有一条 user 消息；解除订阅后不再收到事件。',
 'bun --inspect-brk test tests/01-session.test.ts', 'Session.emit：对照 events、messages、listeners 在同一事件前后的变化。',
 '临时去掉 dispose()，测试中的 received 会变成 2；恢复后重跑。',
 '不看代码解释：为何一份日志能产生模型历史与界面两个视图？',
 '增加第二个订阅者，只移除第一个，第二个应继续收到事件。'),
('02', '先把模型看成一条流',
 '先用自己的话描述“一次返回整个字符串”和“分三次到达”的区别。',
 'Model 接收历史、工具声明和取消信号，返回异步事件流。text 是增量；call 是已经组装好的完整工具调用；usage 是用量；finish 只结束一次模型 step，尚不一定结束用户 turn。',
 'bun scripts/stream-demo.ts\nbun test tests/02-stream.test.ts\nbun test',
 '依次看到三条 text、一条 usage 和一条 finish；固定错误样本在首片后失败，没有 finish。',
 'bun --inspect-brk scripts/stream-demo.ts', 'fakeModel 的 yield 前后；每次继续只观察一个分片。',
 '将演示输入改成 /error，确认已输出“收到：”后抛错，不能补发成功终止。恢复“你好”。',
 '合上示例，写一个只输出两片文本和 finish 的异步生成器。',
 '把中文拆成“早”“上好”，接收端仍可按顺序拼回原句。'),
('03', '给模型准备第一个真实文件工具',
 '先尝试用程序读取 package.json，然后思考 ../ 和符号链接是否能逃出工作区。',
 '工具的 Schema 用来告诉模型怎样填参数，run 才是本机执行。模型声明参数不可信，执行前必须解析与验证。Tools 是可卸载的注册表，workspacePath 同时检查路径和符号链接。',
 'bun test tests/03-tools.test.ts\nbun test',
 '读到临时文件内容；../ 与指向工作区外的符号链接被拒绝；卸载后工具表为空。',
 'bun --inspect-brk test tests/03-tools.test.ts', 'Tools.execute 的 JSON.parse、workspacePath 的 relative 与 realpath；比较原路径和真实路径。',
 '测试已创建 outside 符号链接，断在 inside(await realpath(path))，观察它指向工作区外并被拒绝。',
 '不看实现解释：为什么 resolve 检查和 realpath 检查两个都需要？',
 '读取不存在的文件与超过 64KB 的文件，各自应明确失败。'),
('04', '实现第一次模型—工具—模型循环',
 '先手画“模型要求 read → 谁读文件 → 结果放哪里 → 谁再问模型”。',
 'Loop 负责决定是否继续：有工具就执行并把 assistant.tool_calls 和所有 tool 结果成组提交，再请求模型；没有工具且 finish=stop 才结束 turn。调用失败也作为 tool 结果返回，让模型能纠错。',
 'bun scripts/loop-demo.ts\nbun test tests/04-loop.test.ts\nbun test',
 '看到两次 step、一次 tool_start/tool_end，最后 assistant 包含 package.json 的实际内容；整个 turn 只有一次 done。',
 'bun --inspect-brk scripts/loop-demo.ts', 'runAgent 的 model(input,...)、tools.execute 和 emit(messages)；第二次模型调用时检查 input 包含 tool_call_id。',
 '将样本 path 改为 missing.md，工具结果应包含错误，Loop 仍可以请求模型解释失败；恢复 package.json。',
 '不看代码写出 Loop 的核心顺序，并解释为何工具结果不能直接当作 user 消息。',
 '把工具名改成不存在的名字，确认不会执行任意函数，错误进入工具结果。'),
('05', '把取消贯穿整个运行',
 '先找出你认为需要停止的三个地方：等模型、执行工具、等待审批。后两处将在后续验证。',
 'Host 持有每个会话的 AbortController；Loop、Model 和 Tool 共享同一 signal。同一会话只允许一个 active turn，重复提交返回忙。取消是控制信号，不是往聊天记录里追加“停止”两个字。',
 'bun test tests/05-cancel.test.ts\nbun test',
 '首个分片到达后取消；done=cancelled 恰好一次，历史中没有未完成的 assistant；再发同会话任务前必须等 done 释放 active。',
 'bun --inspect-brk test tests/05-cancel.test.ts', 'Host.cancel、signal.throwIfAborted、runAgent catch 与 active.delete。',
 '临时移除 test 中的 host.cancel，预期 cancelled 会失败且模型继续输出；恢复后再跑。',
 '合上代码画出取消从 Host 到 fetch/计时器/工具的传播路径。',
 '任务还没开始输出就取消；结果仍应为 cancelled，不伪造成功。'),
('06', '写入前等待本次审批',
 '先想清楚：点击允许后，到底应该唤醒哪一次工具调用？取消后旧按钮还应不应该生效？',
 'Approvals 保存 sessionId + approvalId 对应的 Promise。入口只负责展示和回答，Loop 等待答案；写工具实际执行之前再次检查 signal。超时、拒绝、取消都不会写入。',
 'bun test tests/06-approval.test.ts\nbun test',
 '别的会话不能回答；取消后 pending 清零，旧 approvalId 再次提交报失效。写工具在本步注册实现，完整接入在第 12 步。',
 'bun --inspect-brk test tests/06-approval.test.ts', 'Approvals.request 的 pending.set、finish、decide；观察审批等待、取消与清理。',
 '测试中先使用 s2 回答 s1 的审批，必须失败；取消后再用 s1 回答同一 ID，也必须失败。',
 '不看代码解释：审批 ID 为什么不能直接复用 toolCallId 或“最近一次操作”？',
 '将测试改成 emit 时立即允许，再次回答同一审批仍应被拒绝。'),
('07', '把事件落盘并恢复会话',
 '先保存两条 JSONL，再手动删除最后半行，预测重启后应保留什么。',
 'JSONL 每行是一条完整事件，先写磁盘并 fsync，再更新内存投影、通知界面。完整行损坏直接报错；末尾没有换行的一行视为未提交尾行。恢复历史不会自动重做已经触发的写文件。',
 'bun test tests/07-journal.test.ts\nbun test',
 '重启恢复出相同 messages 和 seq；尾部半行被清掉；中间 broken 完整行使恢复失败。',
 'bun --inspect-brk test tests/07-journal.test.ts', 'Session 构造器读取日志、apply 重建投影、emit 中 writeSync/fsyncSync。',
 '测试会真实追加 {"seq": 半行和 broken 损坏行；分别观察可恢复与必须失败的边界。',
 '合上实现解释：为什么不能先通知 UI 成功，再去写日志？',
 '把已提交消息换成含中文和换行的内容，恢复后应完全一致。'),
('08', '执行命令并回收子进程',
 '先运行一个输出 ok 且退出码为 3 的进程，区分程序成功启动与命令执行成功。',
 'run 工具接收 argv 数组，通过 spawn 直接执行，不经过 shell。它是有审批的本机命令执行器；5 秒超时、64KB 输出上限、取消信号共同限制生命周期。在 macOS/Linux 结束进程组，Windows 本教程只保证直接子进程结束。',
 'bun test tests/08-process.test.ts\nbun test',
 '结果包含 code=3 和真实输出；超大输出时进程被终止并报 64KB。权限门由 Loop 统一处理，本工具不重复问一次。',
 'bun --inspect-brk test tests/08-process.test.ts', 'spawn、collect、terminate、close；检查 child.pid、输出字节数、退出码。',
 '执行输出 100000 字符的固定样本，必须终止，不允许无限堆积输出。',
 '不看代码解释：为什么“进程启动成功”不能等同于“工具任务成功”？',
 '用一个一直等待的程序验证 5 秒超时，再用 signal 立即取消它。'),
('09', '接入真实 DeepSeek 流与工具参数',
 '先把一条含中文的 SSE 响应按单字节拆开；思考直接对每个 chunk JSON.parse 为什么会错。',
 '适配器先从字节流恢复 UTF-8 和完整 SSE 帧，再按 tool_calls.index 拼接 id/name/arguments，直到 [DONE]。HTTP 429/5xx 只在正文开始前有限重试；已输出内容后的流失败直接报错，避免重复展示和重复工具执行。',
 'bun test tests/09-provider.test.ts\nbun test',
 '中文未损坏、工具 JSON 参数完整；缺少 [DONE] 时失败。测试使用真实解析器与固定 HTTP 正文，不消耗模型额度。真实调用在第 13 步统一验收。',
 'bun --inspect-brk test tests/09-provider.test.ts', 'sseData 的 buffer、deepseekModel 的 calls Map 与 finish；观察 TCP chunk 与语义事件的不同。',
 '测试去掉 [DONE]，应该出现“模型流提前结束”，不能输出 finish=stop。',
 '合上代码说明：finish_reason、[DONE]、turn done 三者分别在哪里产生？',
 '同一 SSE 帧改成 CRLF 换行，再在一个字节块里放多帧，仍然能解析。'),
('10', '固定配置与上下文边界',
 '先估算：读取 100 个大文件后，你会把什么留在下一次模型请求里？',
 '启动配置决定模型后端、工作区与日志目录；用户 prompt 不能改变这些权限边界。上下文按完整 turn 裁剪，不拆开工具调用和结果；最新 turn 本身超限就明确失败。日志仍保留完整历史，裁剪只影响发给模型的副本。',
 'cp .env.example .env\nbun test tests/10-context.test.ts\nbun test',
 '旧 turn 整组移除，原历史不变；单个巨大 turn 明确报超限。此时 .env 保持 MODEL_BACKEND=fake，后面才统一接真实调用。',
 'bun --inspect-brk test tests/10-context.test.ts', 'prepareContext 的 turns、size 和 shift；对照输入历史与输出副本。',
 '把 maxChars 调到小于最新任务大小，必须报超限；不能只截掉 tool_call 的半截。',
 '不看代码解释：为什么日志历史和模型上下文应该分开？',
 '给旧 turn 加两个工具结果，裁剪后不能留下任何孤立 tool 消息。'),
('11', '装配插件、Skill 和项目记忆',
 '先说明你希望项目规则、做事方法和长期事实分别放哪里。',
 'Kernel.install 管 effect 的安装与反向清理；Skills 是给模型的操作方法，MEMORY 是人工确认的事实。它们被启动时加载进 system 上下文，不会自动获得工具权限，也不会覆盖审批。固定三个来源让主线保持可追踪。',
 'bun test tests/11-plugin.test.ts\nbun test',
 '第二个 effect 重名失败时，第一个已注册工具也被回滚；不会遗留半安装插件。',
 'bun --inspect-brk test tests/11-plugin.test.ts', 'Kernel.install 的 added 数组与 catch；观察反向 dispose。',
 '固定样本连续注册两个名为 x 的工具，错误后工具表必须为空。',
 '合上代码说清：Skill 的文字和可执行工具分别通过哪个入口进入系统？',
 '先安装两个不同工具再 dispose，确认两者均被卸载。'),
('12', '把核心组装成同一个 Runtime',
 '先画出启动时谁创建模型、谁装工具、谁恢复会话；检查是否无意写了两套工具注册。',
 'createRuntime 是唯一组装点。Host 管运行，Session 管事实，Tools 管执行，Approvals 管等待。日志目录用独占 host.lock 防止双进程写；崩溃历史只补 interrupted，不自动重放副作用。',
 'bun scripts/host-demo.ts\nbun test tests/12-runtime.test.ts\nbun test',
 '工具读到实际 package.json；写入只有收到允许才发生；关闭后可恢复历史；同一目录再开 Host 被拒绝。',
 'bun --inspect-brk scripts/host-demo.ts', 'createRuntime、Host.start、Approvals.request；从一次 prompt 沿调用栈走到 Tool 和第二次 Model。',
 '第一个 Host 没关闭时启动第二个，必须报 EEXIST；正常 shutdown 后锁应删除。强杀导致旧锁时，先确认原进程已退出，再删除该目录的 host.lock。',
 '不看代码画出 Runtime 各个对象持有谁，并说明哪个对象负责清理。',
 '把审批答案改为 false，hello.txt 必须不出现，模型应收到拒绝结果。'),
('13', '用 CLI 完成真实模型工具闭环',
 '先用固定样本读文件和写文件，确认你能把输入、分片、审批和结果对应起来。',
 'CLI 只接输入、显示事件和回答审批，调用的仍是 runtime.start。Ctrl+C 取消并退出当前 CLI 进程；不传参数可连续对话。SESSION_ID 恢复已有会话。现在才切真实模型，定位故障时可以区分网络问题与 Loop 问题。',
 'bun run dev "/tool read {\"path\":\"package.json\"}"\nbun run dev\nbun test',
 '先在连续会话输入 /tool write {"path":"hello.txt","content":"你好"}，输入 yes 后文件出现；然后 /exit。保持同一顺序，在 .env 将 MODEL_BACKEND 改为 deepseek、填自己的 Key，再运行 bun run dev "读取 package.json，解释启动命令"，看到真实工具调用和回答。完成后 MODEL_BACKEND 改回 fake，继续后面的确定性协议验收。',
 'bun --inspect-brk src/main.ts "/tool read {\"path\":\"package.json\"}"', 'runtime.start → runAgent → tools.execute；真实模式再断在 deepseekModel 的 fetch。切换后端只改 .env，不改 Loop。',
 '固定模型输入 /error，应输出首片后结束为 error；输入 /slow 后 Ctrl+C，应取消并清理锁。真实 Key 不正确时只报告 HTTP 状态，不把 Key 打印进笔记。',
 '合上实现解释：为什么模型会调用 read，但真正读取文件的是你的程序？',
 '记下终端的 sessionId，正常退出后用 SESSION_ID=实际ID bun run dev 恢复；再问一个后续问题。'),
('14', '增加 HTTP API、事件重放与取消审批',
 '先区分提交任务的 HTTP 响应与随后持续到达的输出：哪个应该先返回？',
 'POST prompts 返回 202 与 turnId，事件从独立 SSE 连接持续到达；断线从 seq 续传。同会话忙时 409；requestId 在当前进程最近 1000 条请求内去重。Bearer 或 HttpOnly cookie 授权，加上 Host/Origin 检查。断开 SSE 只取消订阅，停止任务必须显式调用 cancel。',
 'bun test tests/14-http.test.ts\nbun test\nHARNESS_DATA=.harness-web bun src/server.ts',
 '测试覆盖真实 HTTP/SSE。服务输出启动 URL，含本次随机 token；用下文 API 表和第二个终端验收。第 15 步才提供页面，因此本步浏览器首页暂时返回缺少 Web 文件的 404 是预期。',
 'HARNESS_DATA=.harness-web bun --inspect-brk src/server.ts', 'serve 的 prompts/events/cancel 分支和 runtime.start；SSE controller.enqueue 只转发事件，不再请求模型。',
 '不用令牌 GET /api/sessions 得到 401；同 requestId 同内容返回同 turnId，不同内容 409；取消 /slow 后 done=cancelled。验收结束 Ctrl+C。',
 '不看实现画出两条连接：POST 接收任务、SSE 推送事件；再标出取消的第三次请求。',
 '事件流 after=2 只补 seq>2 的事件，重复事件由客户端按 seq 丢弃。'),
('15', '让 Web 操作完整同一会话',
 '先预测刷新页面时会丢掉哪些状态，哪些应该从服务端重新拿。',
 '页面先取事件快照，再建立 after=cursor 的 SSE；实时事件与历史事件用同一个 apply。文本只用 textContent，工具输出不能执行 HTML。审批按钮回答 approvalId；取消只调用 Host 控制接口。localStorage 仅记会话 ID，历史事实仍在服务端。',
 'HARNESS_DATA=.harness-web bun src/server.ts',
 '用终端这次输出的完整启动 URL 打开自己的应用，依次完成下文固定 Web 验收。刷新后历史恢复；关闭浏览器不会自动取消任务。结束时回终端 Ctrl+C。',
 'HARNESS_DATA=.harness-web bun --inspect-brk src/server.ts', '后端断在 start/cancel；浏览器开发者工具断在 apply(event)、Network 的 prompts 和 events。',
 '输入 /slow 后点击取消；输入写文件样本等待按钮，先拒绝，再提交新任务允许；取消后的旧审批不应再有效。',
 '关闭参考，从 Network 解释一个 text 分片经过了哪些层，浏览器为什么拿不到 API Key？',
 '在一轮输出期间刷新页面，再断开网络后恢复，确认不会重复拼出同一 seq 的文本。'),
('16', '实现自己的 ACP 粘合层',
 '先标出 initialize、新建会话、prompt、update、cancel 和 permission 各是谁调用谁。',
 'SDK 负责 JSON-RPC/NDJSON；src/acp.ts 把协议映射到同一个 Runtime。prompt 等整轮完成再返回；中间 text 经 session/update 推送；审批通过 Agent→Client 的 requestPermission 反向请求。SDK 固定 1.4.0，与仓库 dsh-acp 依赖一致，不能直接替换成本地另一个版本的 checkout。',
 'bun add --exact @agentclientprotocol/sdk@1.4.0 zod@3.25.76\nHARNESS_DATA=.harness-acp bun scripts/acp-client.ts\nHARNESS_DATA=.harness-acp-cancel ACP_CANCEL=yes bun scripts/acp-client.ts /slow\nHARNESS_DATA=.harness-acp-write ACP_ALLOW=yes bun scripts/acp-client.ts "/tool write {\"path\":\"acp-proof.txt\",\"content\":\"ok\"}"\nbun test',
 '三个真正的跨进程样本分别得到 end_turn、cancelled、end_turn；第三个收到反向审批且 acp-proof.txt=ok。固定客户端的 ACP_ALLOW=yes 只用于这条明确的验收命令。',
 'HARNESS_DATA=.harness-acp-debug bun --inspect-brk src/acp.ts', '需要调试协议时，由客户端的 spawn 参数加入 --inspect-brk，再连接该子进程的 Inspector；分别断在 onRequest(session/prompt)、ctx.client.notify 和 onNotification(session/cancel)。不能直接向 ACP stdin 输入自然语言。',
 '把 console.log("debug") 加进 ACP 服务端会破坏 stdout 协议，客户端解析失败；诊断改用 console.error 后重跑。不要在自己正式实现中保留这条故障代码。',
 '不看代码画出 ACP prompt 的 RPC 响应与 update 通知为什么可以交错，取消是否有独立请求响应。',
 '把目标文件改为 deny-proof.txt，再将 ACP_ALLOW 改为 no，确认没有创建目标文件，模型收到拒绝工具结果。'),
('17', '用 pi-ai 替换模型适配器',
 '先找出哪一层应该感知 pi-ai 的 toolCall、toolResult 和 text_delta，哪几层不该改变。',
 'pi-ai 是独立的模型访问包。这里接入固定版本 1.1.0 的真实 SDK，将领域历史转为它的消息格式，再把 SDK 事件转回 Part。使用它的底层 openai-completions API 与 normalizeContext，继续保持同一个 Model 接口；本教程固定关闭 thinking，不实现跨提供方推理签名回放。',
 'bun add --exact @earendil-works/pi-ai@1.1.0\nbun test tests/17-pi.test.ts\nbun test',
 '固定 HTTP 样本由真实 pi-ai SDK 处理并输出领域 text/finish。随后在 .env 将 MODEL_BACKEND 从 fake 改为 pi，使用第 13 步同一个读文件任务验证真实模型；结束后改回 fake。不改 Host、Web 或 ACP。',
 'bun --inspect-brk test tests/17-pi.test.ts', 'piModel 的历史转换、streamSimple、text_delta 与 done；对比你自己 SSE 适配器的边界。',
 '将测试 finish_reason 改成 length，适配器必须输出 length，Loop 会将它标为未正常完成，不能当作 stop。',
 '合上资料解释：接入 pi-ai 后，哪些复杂性由包承担，哪些仍必须由 Harness 处理？',
 '用真实模型重复一个需要 read 的任务，确认第二次模型请求的 toolResult 关联到正确工具名。'),
('18', '通过 MCP 接入外部工具进程',
 '先对照本机 read 工具：当工具挪到另一个进程，需要额外管理什么？',
 'MCP Client 在启动时 initialize、listTools，把远端工具包装进同一个 Tools；执行时 callTool，结果回到原 Loop。这里固定一个只读提供方，并仍要求审批，不盲信远端能力声明。HARNESS 的取消信号传入 SDK 请求，关闭 Runtime 必须关闭 MCP 子进程。',
 'bun add --exact @modelcontextprotocol/sdk@1.25.3\nbun test tests/18-mcp.test.ts\nbun run dev "/tool mcp_project_info {}"\nbun test',
 '测试启动真正 MCP 服务进程并读到 package.json；CLI 明确允许这次调用后得到结果；退出后服务进程释放。',
 'bun --inspect-brk test tests/18-mcp.test.ts', 'mountMcp 的 connect/listTools/register，以及工具包装器中的 client.callTool。服务端 stdout 同样只放协议。',
 '临时让远端 project_info 读取 missing.json，应返回 isError，客户端转换为工具错误而非成功文本。恢复 package.json。',
 '不看资料画出 Tools→MCP Client→stdio→MCP Server→文件，再把结果反向画回 Loop。',
 '卸载 MCP 后调用旧工具名，应立即得到未知工具；不能访问已经关闭的 Client。'),
('19', '通过 LSP 获取语言诊断',
 '先在一个 .ts 文件写 const x = ;，预测工具应该给出文字报错还是结构化位置。',
 'LSP 与 MCP 使用不同线协议：本步使用 Content-Length 帧完成 initialize、didOpen、diagnostic、didClose、shutdown/exit。固定教学语言服务调用真正 TypeScript 编译器，只提供语法诊断；不假称拥有跨文件类型分析、重命名或补全。',
 'bun add --exact vscode-jsonrpc@8.2.1\nbun add --dev --exact typescript@5.9.3 @types/bun@1.4.3\nbun test tests/19-lsp.test.ts\nbun test',
 '真实语言服务子进程对坏语法返回带 range/code/message 的诊断；修正为 const x = 1 后 items 为空。',
 'bun --inspect-brk test tests/19-lsp.test.ts', 'registerDiagnostics 的 sendRequest 与诊断结果；服务端 onRequest(textDocument/diagnostic) 调用 transpileModule。',
 '测试先创建坏文件再修正，每次新建短生命周期连接；检查两次结果及子进程退出。',
 '合上资料解释：为什么工具调用、编辑器协议、模型协议不能直接当作同一种消息格式？',
 '文件首行增加中文注释再制造第二行语法错误，观察 range 按 UTF-16 行列表示。'),
('20', '让一个只读子 Agent 完成委派',
 '先列出父 Agent 与子 Agent 应当共享什么、隔离什么。',
 '共享 Model 与取消信号，隔离 Session 和 Tools；子工具表只有 read，没有 write、run 和 delegate_read，因此不能递归派生。最多三次模型请求，结果作为父工具结果回传，不把子历史混进父会话。',
 'bun test tests/20-subagent.test.ts\nbun run dev \'/tool delegate_read {"task":"/tool read {\\"path\\":\\"package.json\\"}"}\'\nbun test',
 '委派读文件返回结果；委派写文件只能得到未知工具错误；父 Agent 再继续自己的模型 step。',
 'bun --inspect-brk test tests/20-subagent.test.ts', 'registerSubagent 中的独立 Session、childTools 与 runAgent；比较父子 messages。',
 '测试中调用子 Agent 的 write，必须失败，且不创建 oops.txt。',
 '不看代码解释：为什么子 Agent 不能直接复用父 Agent 的完整工具表？',
 '父任务取消时子任务也停止；尝试委派 delegate_read 应被拒绝为未知工具。'),
('21', '用 Electron 主进程托管自己的 Host',
 '先画主进程、preload、renderer、Host 子进程四个领域，标出哪个能接触文件和密钥。',
 '主进程选择工作区、启动 Host 并等待 ready 行；renderer 加载同一 Web 应用，经 cookie 调用同一 API。preload 只暴露固定 info 方法，IPC 校验主 frame 来源。退出时先 SIGTERM 等待 Host 清理，再超时强制结束。',
 'node --version\nnpm --version\ncd desktop\nnpm install\nnpm run start',
 '本步要求 Node >=22.12，验证基线为 Node 24；系统 Node 18 无法运行 Electron 45 安装器。窗口启动后选择教程项目目录；按第 15 步同一顺序完成发送、取消、审批、刷新。关闭窗口后 Host 退出，data 锁释放。',
 'HARNESS_DATA=.harness-desktop-debug bun --inspect-brk src/server.ts', '先用独立 Host 定位核心；桌面主进程可在 spawn 参数中给 Bun 增加 --inspect-brk，再连接子进程 Inspector。renderer 用 window.webContents.openDevTools() 临时打开，断在同一个 apply。',
 '关闭窗口时保持一项审批等待，检查 Host 不再运行；重启后旧审批不能恢复成同意。主进程被强杀时旧锁需确认进程退出后清理。',
 '关掉参考，解释一次按钮点击如何经过 renderer→HTTP→Host→Loop，并指出 preload 的实际作用。',
 '工作区路径包含中文和空格时仍能启动；取消工作区选择应干净退出，不生成窗口或后台 Host。'),
('22', '加上不会阻塞任务的观测与资源 Compose',
 '先区分应用事件日志和运维观测日志：哪一份负责恢复会话？',
 'JSONL 负责事实与恢复；OTLP 只导出事件类型、身份和序号。导出器限制队列、超时并吞掉外部失败；模型主流程不等它。Docker 只运行 Collector，Bun、Web、ACP、Electron 都继续在本机。',
 'bun test tests/22-telemetry.test.ts\nbun test\ndocker compose config --quiet\ndocker compose up -d otel-collector\ncurl --fail http://127.0.0.1:13133/\nOTEL_LOGS_ENDPOINT=http://127.0.0.1:14318/v1/logs bun run dev "观测验收"\ndocker compose logs --tail=100 otel-collector\ndocker compose down',
 'Collector 控制台出现 service.name=my-harness 与事件身份，不包含用户任务正文。镜像未下载成功就不能记为 Collector 验收通过；离线测试只验证导出请求和失败隔离。',
 'bun --inspect-brk test tests/22-telemetry.test.ts', 'observe 的 pending、flush 与 catch；运行结束后关闭 timer 和订阅。',
 '保持 OTEL_LOGS_ENDPOINT 但关闭 Collector，任务仍应完成，退出最多等待有限导出超时。',
 '不看代码说明：为什么观测服务断开不能变成模型调用失败？',
 '任务正文填一段明显标记，确认 Collector 输出里没有它。'),
('23', '构建、打包并完成整条链路验收',
 '先预测编译成独立二进制后，process.execPath 再拿去运行 script.ts 会发生什么。',
 'launcher 在一个自带 Bun 运行时的二进制里按角色启动 Host/MCP/LSP；不再假设用户机器装了 Bun。桌面包携带 Host 与 Web 资源，安装包数据写 userData，不写只读应用目录。本步产出当前平台未签名应用目录；签名、公证、自动更新和多平台发布不冒充已实现。',
 'bunx tsc --noEmit\nbun test\nbun scripts/package.ts\ncd desktop\nCSC_IDENTITY_AUTO_DISCOVERY=false npm run package',
 '类型检查、累计测试与 Host 编译成功；桌面输出目录出现当前平台应用。macOS 常见路径 desktop/out/mac-arm64/My Harness.app 或 mac/My Harness.app，按实际构建日志确认。打开包后按最终验收表逐项执行，终端不再额外启动 Host。',
 'HARNESS_COMPILED=1 HARNESS_DATA=.harness-binary HARNESS_WEB="$PWD/web" PORT=0 ./desktop/host/harness-host', '先单独运行编译 Host，检查 ready URL，再在打包应用中观察子进程启动、资源路径和退出；编译版依赖 JS source map 的体验与源码调试不同。',
 '把打包准备得到的 Host 临时改名再启动包，必须明确报告缺少 Host；恢复并重新打包。不能悄悄退回开发源码。',
 '合上全文，从空白纸画完整系统，并沿真实 prompt、流、工具、审批、取消、恢复各走一次。',
 '复制一个新的工作区，加入一个不同的 README，用同一个包完成读取、审批修改、取消、重启恢复。无需修改 Loop 或三个协议入口。'),
]

INTRO = r'''# DeepSeek Harness 核心原型：24 步单线实操教程

从第 00 步开始，按 01、02……一直做到 23。每步都在同一个项目上增加能力，全部前置都是之前的步骤；没有路线选择，也不需要学习站点。CLI → Web → ACP → Electron 是依次完成的四个入口，不是四选一。

最终做出的程序能：持续对话并流式显示 DeepSeek 回答、读取和经审批写入文件、执行有超时的本机命令、循环调用工具、取消任务、恢复会话、通过 Web/ACP/Electron 使用同一核心、接入 pi-ai/MCP/LSP、委派只读子任务、导出观测日志，最后打包成当前平台的桌面应用。

**本文定位已更正为核心原型。目标已升级为完整复刻，实施范围与固定顺序见 [完整复刻差距与验收清单](完整复刻差距与验收清单.md)。** 当前固定原版提交有 52 个包组、342 份 packages 包清单；24 步尚未实现全部功能、接口、持久化、Web/Desktop 与交付契约。原文件名保留以兼容已有链接，不表示已经完成原版复刻。

## 只需要记住的操作规则

1. **在哪里写：**新目录 `~/ws/my-harness`。你已经在另一个空目录开始过，也按本文顺序核对已有内容；不要覆盖课程仓库里正在写的 `harness-from-zero`。
2. **在哪里运行：**除桌面章节明确 `cd desktop` 外，命令都在 `~/ws/my-harness` 根目录执行。每个章节的命令块都会先回到根目录。
3. **怎样改文件：**“新增”先创建父目录再建文件；“完整替换”把该文件改成下方完整内容。没有出现的文件继续保留，不需要猜省略代码。
4. **怎样知道能继续：**先通过本节专门检查，再运行累计 `bun test`。新功能和以前功能都通过，再闭卷做本节末的小变体。
5. **怎样记录：**在项目根目录新建 `LEARNING.md`，只记“先试卡点、我的解释、运行证据、故障修正、下次复习日期”。不要把 Key、启动 token 或文件中的秘密贴进笔记。

本地前置：Bun 1.3.14；桌面阶段使用 Node 24（至少 22.12）与 npm；第 22 步启动 Collector 时需要 Docker Compose。前 00～12 步全部离线，不需要模型 Key 或容器。真实模型在第 13 步和第 17 步各验收一次，其余协议先用固定模型验证。

依赖均在指定步骤锁版本安装：ACP SDK 1.4.0、pi-ai 1.1.0、MCP SDK 1.25.3、vscode-jsonrpc 8.2.1、TypeScript 5.9.3、@types/bun 1.4.3、Electron 45.0.0、electron-builder 26.0.12。保留生成的 bun.lock 与 desktop/package-lock.json，重装分别使用 `bun install --frozen-lockfile`、`npm ci`。

## 把学习方法放进每一步

每步先独立试一个小任务，暴露当前卡点；本节代码是唯一主材料。把“一起工作的概念、调用顺序、失败条件”作为一个知识块。随后运行程序和测试拿反馈，刻意制造一次错误、修正并重跑，再合上代码解释或重写关键部分，最后换一组输入验证迁移。

隔一段时间再开始下一步时，先按该步的“回忆前面的实现”复习；第 3 天和第 7 天只重做笔记里仍然卡住的块。**看过示例、照抄成功、闭卷独立做出，是三种不同状态。** 代码写在下面是为了帮你校准；自己先试一小段，再对照纠错。

每次卡住沿同一条处理顺序：确认工作目录 → 确认本步文件已保存 → 运行指定测试 → 读第一条报错 → 在本节指定断点观察 → 改正 → 重跑本节和累计测试。解决后继续当前章节，不跳去另一条路线。

## 最终全貌：明确领域

```mermaid
flowchart TB
  subgraph user[用户操作领域]
    terminal[终端输入与输出]
    browser[浏览器界面]
    editor[编辑器或 ACP 验收客户端]
    renderer[Electron renderer：同一 Web 页面]
  end
  subgraph adapters[接入领域：各自处理协议]
    cli[CLI 适配器]
    http[HTTP 与 SSE 适配器]
    acp[ACP SDK 与自写粘合层]
    desktop[Electron main 与 preload]
  end
  subgraph shared[共用运行领域：同一个 Host 实现]
    host[Host：会话和运行控制]
    session[Session：事件日志和历史]
    approval[Approvals：等待与回答]
    loop[Agent Loop：模型与工具循环]
    tools[Tools：文件、命令、MCP、LSP、子 Agent]
  end
  subgraph providers[模型提供方领域]
    model[统一 Model 接口]
    native[自己实现的 DeepSeek HTTP 与 SSE 适配]
    pi[pi-ai 适配]
    remote[DeepSeek API]
  end
  terminal --> cli --> host
  browser <-->|HTTP 提交 / SSE 输出| http
  editor <-->|JSON-RPC / NDJSON| acp
  renderer <-->|HTTP / SSE| http
  desktop -->|启动、就绪、退出| host
  desktop <-->|固定 info IPC| renderer
  http --> host
  acp --> host
  host --> session
  host --> approval
  host --> loop
  loop --> tools
  loop --> model
  model --> native --> remote
  model --> pi --> remote
```

“共用”指复用同一份 Host/Loop 实现。CLI、Web、ACP 分别启动时是独立进程，有各自数据目录；Electron 启动自己的 Host 子进程，复用同一 Web 页面。本文没有声称四个进程共享同一块内存。同一数据目录只允许一个 Host 写入。

```mermaid
sequenceDiagram
  participant U as 用户界面 / ACP 客户端
  participant A as HTTP 或 ACP 适配器
  participant H as 共用 Host
  participant L as Agent Loop
  participant M as Model 适配器与模型 API
  participant T as Tools
  U->>A: 提交 prompt
  A->>H: start(sessionId, prompt)
  H->>L: runAgent(signal)
  L->>M: history + tools + signal
  M-->>L: text / call / finish
  L-->>H: Session.emit(text)
  H-->>A: 领域事件
  A-->>U: SSE 或 session/update
  L->>H: 等待一次审批
  H-->>A: approvalId + toolCall
  A-->>U: 审批按钮或 requestPermission
  U->>A: 允许一次
  A->>H: approvals.decide
  L->>T: execute(call, signal)
  T-->>L: tool result
  L->>M: 含 tool result 的下一次请求
  U->>A: cancel
  A->>H: cancel(sessionId)
  H->>L: controller.abort()
  L->>M: 终止等待中的请求
  L-->>H: done(cancelled)
  H-->>A: 领域终止事件
  A-->>U: Web 终止事件 / ACP prompt 响应
```

调试统一做法：执行每步给出的 `bun --inspect-brk ...`，终端会打印 Inspector 链接。打开该链接，找到对应源码，设置本节列出的断点，继续执行后看变量和调用栈。停在首行是 `--inspect-brk` 的预期行为，不是程序卡死。调试完退出进程，再运行正常命令验收。

## 固定顺序

| 步骤 | 本步成果 |
| --- | --- |
'''

API_TABLE = r'''
### 第 14 步的全量 HTTP API 与调用方向

这里列的是**你在本文实现的 API**，不冒充原仓库的所有 API。

| 用户端 → 服务端 | 输入 / 返回 | 共用能力 |
| --- | --- | --- |
| GET /api/sessions | 返回 id、busy 列表 | host.sessions |
| POST /api/sessions | 返回 201 与新 id | host.create |
| GET /api/sessions/:id | 事件快照与 busy | host.get |
| POST /api/sessions/:id/prompts | prompt、requestId；返回 202 与 turnId | runtime.start → host.start → runAgent |
| GET /api/sessions/:id/events?after=N | 服务端 → 用户端持续发送 SSE；id=seq | session.subscribe + events 重放 |
| POST /api/sessions/:id/cancel | 返回 ok；终止结果经 SSE 到达 | host.cancel → AbortController |
| POST /api/sessions/:id/approvals | id、allow；旧审批失败 | approvals.decide |
| GET /?token=启动令牌 | 303 换 HttpOnly cookie，再到 / | 仅接入身份 |
| GET / 与 GET /app.js | 自己的 Web UI 资源 | 第 15 步创建 |

SSE 断开清理订阅，不自动取消模型。Last-Event-ID 优先于 after，客户端使用 seq 去重；无活动任务时仍有心跳。requestId 只保证当前进程最近 1000 条提交去重，重启后的“恰好一次执行”不在本文契约内。每会话同一时间一个任务；会话忙先等待 done，再发下一条，本教程不实现隐式队列。

服务终端保持运行，在**第二个终端**按顺序执行。TOKEN 手动填本次启动 URL 的 token，SID 填新建接口返回的 id；这是运行时值，不是待实现代码。

```sh
cd ~/ws/my-harness
export TOKEN='本次启动URL中的token'
curl --fail -H "Authorization: Bearer $TOKEN" -X POST http://127.0.0.1:4319/api/sessions
export SID='上一条返回的id'
curl --fail -N -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:4319/api/sessions/$SID/events?after=0"
```

上面的事件连接会持续等待，另开**第三个终端**发任务与取消：

```sh
cd ~/ws/my-harness
export TOKEN='同一个启动token'
export SID='同一个会话id'
curl --fail -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"prompt":"/slow","requestId":"http-proof-1"}' "http://127.0.0.1:4319/api/sessions/$SID/prompts"
curl --fail -H "Authorization: Bearer $TOKEN" -X POST "http://127.0.0.1:4319/api/sessions/$SID/cancel"
```

第二个终端应出现 start、messages、done(cancelled)，取消得较晚时还可能有 text。重复同一请求仍得到同一 turnId。最后在第二个终端 Ctrl+C 只断开事件连接，在服务终端 Ctrl+C 才关闭 Host。
'''

WEB_CHECK = r'''
### 第 15 步固定验收顺序

1. 创建会话，输入 `你好`，看逐片输出。
2. 输入 `/tool read {"path":"package.json"}`，看到工具与最终回答。
3. 输入 `/slow`，首片到达后点击取消，显示 cancelled。
4. 输入 `/tool write {"path":"web-proof.txt","content":"ok"}`，先拒绝；文件不应出现。
5. 重新提交同一写入任务，允许一次；检查本机 web-proof.txt=ok。
6. 刷新页面，历史还在，文本不重复；再用同一会话发一个任务。
7. 服务端正常退出重启，使用**新启动 URL**重新取得 cookie；磁盘会话继续存在。

前面删除的是课程“学习工作台”。本章的 Web 是你自己实现的 Harness 产品界面，源码写在新项目的 web/，不会重新创建课程站点。
'''

ACP_TABLE = r'''
### 第 16 步 ACP 方向与 SDK 方法

| 方向 | 协议 | 本文 SDK 调用 / 处理 | 本文共用方法 |
| --- | --- | --- | --- |
| 客户端 → Agent 服务端 | initialize | ctx.request(methods.agent.initialize) / onRequest('initialize') | 返回实际支持的能力 |
| 客户端 → Agent 服务端 | session/new | buildSession(...).withSession / onRequest('session/new') | host.create |
| 客户端 → Agent 服务端 | session/prompt | session.prompt / onRequest('session/prompt') | runtime.start |
| Agent 服务端 → 客户端 | session/update | ctx.client.notify(methods.client.session.update) | session.subscribe |
| 客户端 → Agent 服务端 | session/cancel，通知 | ctx.notify(methods.agent.session.cancel) / onNotification | host.cancel |
| Agent 服务端 → 客户端 | session/request_permission，反向请求 | ctx.client.request(methods.client.session.requestPermission) | Approvals 等待 |
| 客户端 → Agent 服务端 | prompt 的最终 RPC 响应 | session.nextUpdate 返回 kind=stop | done → end_turn/cancelled |

本文 ACP 能力声明只支持文本、新建会话、prompt、流、取消、工具状态与一次审批；loadSession=false。原版 dsh-acp 的恢复、模式配置和远端 MCP 挂载有额外实现，本文没有宣称协议已经全量兼容。文件工具由 Host 执行，不另走客户端 fs/read_text_file；这取决于自己的适配器契约。
'''

FINAL = r'''
## 最终验收：按这一个顺序做完

| 顺序 | 操作 | 必须拿到的证据 |
| --- | --- | --- |
| 1 | MODEL_BACKEND=fake，bun test | 累计测试全部通过 |
| 2 | CLI 固定 read 任务 | 两次模型 step，一次真实文件读取，一次 done |
| 3 | /error 与 /slow + Ctrl+C | error/cancelled，无伪造成功与残留锁 |
| 4 | 写操作先拒绝，再重新提交允许 | 拒绝无写入，允许只执行当前调用 |
| 5 | 正常退出，SESSION_ID 恢复 | 相同历史、连续 seq、后续任务正常 |
| 6 | DeepSeek 直连读文件任务 | 真正 HTTP 调用、真实文件工具、第二次模型回答 |
| 7 | pi-ai 重复同一任务 | 更换 Model 适配器，其他层无改动 |
| 8 | Web 发送、取消、审批、刷新 | Network、事件 seq、本机文件与重连结果 |
| 9 | ACP 三个客户端命令 | end_turn、cancelled、反向审批结果 |
| 10 | MCP 与 LSP 测试 | 真实协议子进程，工具结果和结构化诊断 |
| 11 | 只读子 Agent | 独立历史、无法写入/递归、父取消传播 |
| 12 | Collector 关闭与开启各一次 | 关闭不影响任务，开启只收到元数据 |
| 13 | 桌面开发窗口 | workspace、preload、Cookie、Host 生命周期 |
| 14 | 当前平台桌面包 | 携带独立 Host 与 web；不依赖源码或额外 Bun 进程 |
| 15 | 新工作区迁移任务 | 用同一成品完成不同 README 的读/改/取消/恢复 |

第 23 步二进制单独启动命令中要设置 HARNESS_COMPILED=1；它使 MCP/LSP 子进程使用 --mode=mcp/--mode=lsp 启动，而不是把二进制当成 bun script.ts。打包后的 Electron 已自动设置这个变量，并把 Web 路径指向 resources/web。在新终端中用就绪 URL 访问，再从 Web 分别调用 mcp_project_info 与 diagnostics，可验证编译后子角色也正常。

macOS 尚未签名的构建只用于本机验收；正式分发仍需开发者证书、签名、公证及对应平台验证。本文 package 命令产出应用目录，不会自动发布、上传或安装到别人的电脑。

## 完成范围与原版差异

| 领域 | 本文已经给出完整代码 | 原版仍有的生产差异 |
| --- | --- | --- |
| 运行核心 | Host、Session、Loop、工具注册、生命周期 | 原版 Cordis 服务注入、更多插件与配置机制 |
| 模型 | DeepSeek 原生 SSE、pi-ai、工具参数组装、HTTP 有限重试、超时、usage | 多提供方目录/OAuth、thinking 签名与全量消息块、精确 token/费用预算 |
| 交互控制 | 单 active turn、取消、审批超时和一次答复 | 持久队列、steering、分叉/回退、跨端同时控制仲裁 |
| 持久化 | JSONL、重建投影、半行恢复、独占 Host 锁、重启标记 interrupted | SQLite、压缩、迁移、跨进程租约、自动崩溃锁回收、磁盘故障事务保证 |
| 工具 | 读写文件、进程 argv、大小/超时限制、工作区 realpath 校验 | OS 沙箱、PTY、恶意并发替换符号链接的防护、Windows 全进程树回收 |
| 上下文与知识 | 按完整 turn 裁剪、AGENTS/Skill/人工 MEMORY | 模型摘要压缩、自动记忆检索、多模态附件和大文件索引 |
| Web/ACP/Desktop | 全套本文 API、SSE、重连、文本 ACP、preload、受限 IPC、桌面 Host | 原版 Web 的全部管理 API、ACP 全能力、桌面自动更新与分发服务 |
| 扩展 | MCP 标准 stdio、LSP 语法诊断、只读子 Agent | 任意远端传输、完整 IDE 语义能力、并发多 Agent 调度 |
| 观测与交付 | 脱敏元数据 OTLP、失败隔离、资源 Compose、当前平台应用目录 | 长期存储查询、生产监控告警、跨平台签名/公证/自动更新 |

这张差异表用于评估成品能力，不是让你选择下一条学习路线。全文完成后，你已经能沿一条真实调用链实现和调试自己的 Harness；生产差异需要另行设计和验收，不能用“包安装成功”代替功能完成。

## 固定参考材料

主要材料是本文代码；通过本节验收后，用本地原版源码对照职责，而不是跳到另一份教程重新开始。

- 原版 Agent Loop：`deepseek-harness/packages/core/agent-loop/src/agent.ts`、`assistant-stream.ts`、`tool-calls.ts`。
- 原版 Session：`deepseek-harness/packages/core/session/src/index.ts`。
- 原版审批：`deepseek-harness/packages/interaction/user-approval/src/index.ts`。
- 原版 ACP 粘合：`deepseek-harness/packages/acp/acp/src/index.ts`、`session.ts`、`updates.ts`。
- 原版 pi-ai 适配：`deepseek-harness/packages/llm/llm-pi-ai/src/adapter.ts`、`stream.ts`、`context.ts`。

文档编写时原版 checkout 为 `687f282e8625c6b8d11ff58211a90524be2e4317`；ACP 教程固定安装 1.4.0，本地 typescript-sdk checkout 的 package.json 为 2.0.0，阅读时以相应版本接口为准。

DeepSeek SSE 的结束与工具调用格式已核对[官方 Chat Completions 文档](https://api-docs.deepseek.com/api/create-chat-completion/)和[工具调用说明](https://api-docs.deepseek.com/guides/tool_calls/)。本文模型 ID 使用当时官方示例中的 deepseek-flash，可通过环境变量适配账号实际可用型号；真实接口仍需自己的 Key 验收。

Electron 的 contextIsolation、sandbox 和 preload 权限边界参照[官方上下文隔离说明](https://www.electronjs.org/docs/latest/tutorial/context-isolation/)、[进程沙箱](https://www.electronjs.org/docs/latest/tutorial/sandbox)与[安全建议](https://www.electronjs.org/docs/latest/tutorial/security/)。Electron 45 的安装器 engines 要求 Node >=22.12；本教程实际测试使用 Node 24。

## 维护者如何验证本文

steps/00～23 中保存每步新增/完整替换的源文件；build.py 将同一份代码嵌入本文。verify.py 在临时空目录逐步叠加文件，每步跑累计测试，第 16 步跑三种 ACP 跨进程场景，第 23 步跑严格类型检查与 Host 编译。它不会覆盖你自己的工程。

详细执行证据和真实服务验证边界见同目录 VERIFICATION.md。源码可运行不等于学习者已独立掌握；只有闭卷解释、实际操作和换工作区验证都完成，才在 LEARNING.md 记为“能独立使用”。
'''


def main():
    """按唯一顺序生成正文和机器可检查的章节索引。"""
    lines = [INTRO]
    for identity, title, *_ in LESSONS:
        lines.append(f'| [{identity}](#step-{identity}) | {title} |')
    known = set()
    manifest = []
    for number, lesson in enumerate(LESSONS):
        identity, title, attempt, chunk, command, expected, debug_command, debug, failure, recall, transfer = lesson
        files = sorted(path for path in (ROOT / 'steps' / identity).rglob('*') if path.is_file())
        reviews = sorted({max(0, number - gap) for gap in [1, 3, 7] if number > 0})
        lines += [f'\n<a id="step-{identity}"></a>\n\n## {identity} {title}\n',
                  '**本步位置：**' + ('从空目录开始。' if number == 0 else f'接着第 {number-1:02} 步的同一个项目继续。'),
                  '\n**先试，再对照：**' + attempt,
                  '\n**把这一块连起来：**' + chunk]
        if reviews:
            lines += ['\n**回忆前面的实现：**先不看代码，用两分钟复述第 ' + '、'.join(f'{review:02}' for review in reviews) + ' 步的关键调用和一次失败条件；只对忘掉的地方回看。']
        else:
            lines += ['\n先创建唯一实现目录，然后用编辑器打开它：\n\n```sh\nmkdir -p ~/ws/my-harness\ncd ~/ws/my-harness\nbun --version\n```',
                      '\n新建 LEARNING.md，写下“我想独立实现和解释整个 Harness 调用链”，先记录刚才尝试的卡点。']
        lines.append('\n**照着实现：**下列代码就是本节主材料。每个文件均为完整内容，新增文件先建父目录。')
        for path in files:
            name = path.relative_to(ROOT / 'steps' / identity).as_posix()
            action = '完整替换' if name in known else '新增'
            known.add(name)
            language = {'ts': 'ts', 'js': 'js', 'cjs': 'js', 'json': 'json', 'yaml': 'yaml', 'html': 'html', 'md': 'markdown'}.get(path.suffix[1:], 'text')
            lines += [f'\n### {action} `{name}`\n', f'````{language}\n{path.read_text().rstrip()}\n````']
        lines += ['\n### 运行、调试和验收\n', '\n在项目根目录执行；若本节启动了常驻服务，验收完 Ctrl+C 再进入下一步。',
                  '\n```sh\ncd ~/ws/my-harness\n' + command + '\n```', '\n**完成证据：**' + expected,
                  '\n需要逐句观察时执行：\n\n```sh\ncd ~/ws/my-harness\n' + debug_command + '\n```',
                  '\n**断点与观察值：**' + debug, '\n**稳定制造一次错误再修正：**' + failure,
                  '\n**合上资料主动回忆：**' + recall, '\n**换条件验证迁移：**' + transfer,
                  '\n**记到 LEARNING.md：**记录本次解释、实际输出、故障与修正。给仍然卡住的部分记上明天、第 3 天、第 7 天的复习日期；复习时先独立做再对照。只看过代码就记“看过”，照着做成功记“有提示完成”。']
        if identity == '14': lines.append(API_TABLE)
        if identity == '15': lines.append(WEB_CHECK)
        if identity == '16': lines.append(ACP_TABLE)
        if identity == '21': lines += [r'''
### 桌面环境准备与自动冒烟

先在项目根目录检查 `node --version`。如果低于 22.12，按固定环境准备步骤安装 [Node 官方 24 LTS](https://nodejs.org/en/download)，重开终端，再次检查版本；然后继续本章同一组命令，不改选另一套桌面方案。安装器失败时先看 Node 版本，不能把 npm 错误当作你的 IPC 代码错误。

主进程代码内置了维护者冒烟模式，真实创建隐藏 BrowserWindow，检查 preload 固定接口、renderer 的 require 隔离及 HTTP 提交权限，再退出并清理 Host：

```sh
cd ~/ws/my-harness
HARNESS_DESKTOP_SMOKE=1 HARNESS_SMOKE_DATA="$PWD/.harness-desktop-smoke" npm --prefix desktop run start
```

应出现 DESKTOP_SMOKE_PASS，随后应用退出。它不替代你亲自完成发送、流式显示、取消和审批的窗口操作。正常启动每次仍会弹出工作区选择，只有上述专用验收命令使用固定工作区。
''']
        manifest.append({'id': identity, 'title': title, 'files': [path.relative_to(ROOT / 'steps' / identity).as_posix() for path in files]})
    lines.append(FINAL)
    (ROOT / '从空项目到完整Harness.md').write_text('\n'.join(lines) + '\n')
    (ROOT / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    print(f'已生成单线教程：{len(LESSONS)} 步、{sum(len(item["files"]) for item in manifest)} 份完整文件版本。')


if __name__ == '__main__':
    main()
