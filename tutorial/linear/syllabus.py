#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""手工编写每一步的教学动作；源码是独立增量，不从原版复制。"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
LESSONS = []


def add(title, phase, attempt, why, accept, debug, recall, transfer, original, run=None, test=None):
    """课程作者登记一小步；没有对应可运行源码时不允许生成课程。"""
    number = f'{len(LESSONS):03}'
    tests = sorted((ROOT / 'steps' / number / 'tests').glob('*.test.mjs'))
    if not tests:
        raise ValueError('本步没有实际验收代码：' + number)
    test = test or tests[0].relative_to(ROOT / 'steps' / number).as_posix()
    if not (ROOT / 'steps' / number / test).is_file():
        raise ValueError('指定的调试测试不存在：' + test)
    LESSONS.append(dict(id=number, title=title, phase=phase, **{'try': attempt}, why=why,
                        run=run or 'bun test ./' + test, test=test, accept=accept, debug=debug,
                        recall=recall, transfer=transfer, original=original))


add('在真正的空目录接收任务', 'R00',
    '先不看代码，用 Bun 读取一段中文命令行任务。试着运行空任务，观察退出码。',
    '先建立可执行入口和失败反馈。主线使用 Bun 1.3.14 的 JavaScript ESM，把编译配置暂时移出注意力；所有领域代码自己写，后续第三方 SDK 也经接口接入。每一步的 tests 都是可直接调试的驱动程序。',
    '终端输出“收到任务：读取 README”；bun test 通过。空任务退出码为 1，带任务为 0。第一步就有真实进程验收。',
    '断在 input。先看 process.argv，再故意去掉 slice(2)，测试应暴露运行时路径混入任务；恢复后重跑。',
    '关闭材料重新写 input；讲清参数、返回值、错误与进程退出码的关系。',
    '把任务改为带空格的中文句子，空白任务仍应被拒绝。',
    'apps/cli 的输入边界；此时只对照入口行为，不声称已实现 CLI profile 或原版工具。',
    'bun run start "读取 README"\nbun test ./tests/000-entry.test.mjs')
add('先学会收回自己创建的资源', 'R01',
    '写出两个清理函数，预测它们应该按创建顺序还是相反顺序执行。',
    '作用域是资源的主人。后面模型订阅、终端、审批、MCP 连接都归属于一个 Scope；清理失败也不能让别的资源泄漏。把 own、child、close 组成一个知识块。',
    '测试断言 child 在 parent 前清理；重复 close 无副作用；子清理抛错时父资源仍释放。',
    '断在 close 的 reverse 与 catch；临时删掉 catch，order 将缺少 parent，形成稳定的泄漏复现。',
    '不看示例写一个只执行一次的撤销函数，解释为什么 active 要在 await 之前改变。',
    '增加三个子作用域，其中一个清理抛错，其他两个仍应清理。',
    'core/scope 与 Cordis 的所有权/逆序撤销语义；本步不导入原版 Scope。')
add('把服务接口和执行实现分开', 'R01',
    '用同一个 read 调用分别返回 local 与 remote，尝试不改调用方代码。',
    'Services 是能力契约表，Provider 注册实现，Consumer 只 get；会话子层可以覆盖父实现。撤销必须核对注册身份，不能误删其他所有者。',
    '子会话返回 remote，父会话仍为 local；关子层后回到父服务，关父层后明确报缺依赖。',
    '断在 get 的 parent 分支；把 child.provide 改为 root.provide，重复服务断言会立即定位装配错误。',
    '画出父层、子层与两个 fs 实现，然后闭卷重写 get。',
    '创建两个子层，卸载一个，另一个的服务仍然可用。',
    'core 与各领域的 service/provider/consumer 边界；替换提供方不改 Loop。')
add('安装插件，失败时撤销半成品', 'R01',
    '安装第一个服务后故意抛错，想办法证明服务已撤销，而非只打印安装失败。',
    'Plugins 把上一部 Scope 和 Services 连起来。Profile 是有序配置，任何一项失败都回滚本次新装的贡献；已有应用资源不被顺手清掉。',
    '第二插件失败后，第一个插件的 x 服务也不存在；插件树可以正常关闭。',
    '断在 profile catch，临时去掉 remove 循环，测试会读到残留的 x。恢复后再运行全部测试。',
    '写出安装成功、安装失败、显式卸载、全应用退出四条资源路径。',
    '让插件注册两个资源后才抛错，检查二者都被撤销。',
    'boot 的 Loader/Profile 生命周期。这里是自己实现的装配器，不借原版 Loader 自动补业务。')
add('正在运行的请求不跟着设置漂移', 'R01',
    '取出配置对象后修改其 model，再检查之前拿到的对象是否跟着变化。',
    '配置热更新与请求快照分离：Settings 保存新版本，snapshot 是深复制且冻结的请求输入。Bundle/机器/Profile 顺序合并，再在请求边界固定下来。',
    '旧快照仍为 a，新快照为 b，试图改快照会抛错；后层可以明确禁用前层配置。',
    '断在 snapshot 内 freeze；临时把 structuredClone 去掉，观察谁共享了可变引用。',
    '合上资料，解释为什么“下一次请求用新设置”不等于“正在重试的请求也换设置”。',
    '给配置增加嵌套 headers 数组，旧快照仍不能被新提交污染。',
    'llm 的 prepared-call 与请求级配置冻结。')
add('把插件装成真实读文件任务：写事实、显示进度、按序号补读', 'R01',
    '沿用000～004的工程，先尝试让读文件任务、磁盘记录、终端显示分别通过共享Services连接；预测卸载终端插件后，任务是否还能完成。',
    'Events由会话插件提供；读任务插件获取session和settings，固定本次配置并发布事实；终端插件只订阅且把取消订阅归自己的Scope。compose结果实际交给profile装配。真实文件读取、写盘、展示端退出和游标补读组成同一个应用，不再只调用Events的基础方法。',
    '命令行真实读取package.json，显示0～5号事件；卸载终端后第二次仍完成并写入6～11号事件，read(5)能补读。应用退出后插件和注册服务均为0。集成测试同时证明当前任务不随设置更新变化、读文件失败无成功消息、坏观察者不阻断其他观察者；原有磁盘失败与副本隔离测试也保留。',
    '打开tests/005-session.test.mjs，断在session-app.mjs的profile、services.get、settings.snapshot、session.append以及events.mjs的persist/records.push/listener。观察任务中set只影响第二次，移除terminal后listeners.size为0而日志继续增长。暂时把persist移到通知之后，原有磁盘失败测试应失败；恢复原顺序。',
    '合上材料画出共享Services、四个插件Scope、会话事实和两个展示端的位置；说清为什么业务不直接调用display，以及read(5)为什么能补回6～11。',
    '把终端展示回调改成抛错，任务与第二个观察者仍正常；再读取不存在的文件，日志应有tool/error和失败turn/end，没有成功消息。次日闭卷重写终端插件的订阅与Scope清理，第三天重连并补读。',
    'core/session的事实与投影边界、boot装配和提供方/消费方分离。本步没有模型推理：最终文本直接来自真实文件；JSONL最小写入器尚无重启恢复和损坏修复；第006步讲Journal，但本应用尚未接入它。format=1仍非原版V4。',
    run='bun src/session-demo.mjs package.json\nbun test ./tests/005-session.test.mjs', test='tests/005-session.test.mjs')
add('真正落盘、重启与损坏恢复', 'R02',
    '手写两行 JSONL，再在尾部留下半个 JSON。预测哪些可以恢复，哪些必须拒绝。',
    'Journal 负责独占写入、完整行、fsync。Events.persist 连接真实磁盘。只有未提交的尾半行可以截断；中间损坏继续读取会改变事实含义，必须报错。',
    '测试真实创建/关闭/重开文件；双写 EEXIST；中文换行原样恢复；中间坏行被拒绝。',
    '断在 lastIndexOf 与 JSON.parse，分别观察最后半行与 broken 完整行走向。故意把 filter 设为跳过坏行，现有断言应失败。',
    '不看资料解释锁、fsync 和 seq 校验分别防什么，不能防什么。',
    '模拟磁盘写失败，确认 UI 没有提前发布；不要自动重做未知状态的外部副作用。',
    'session-persistence-jsonl 的尾部修复、所有权与持久边界；原版 V4 互读仍需专门适配。')
add('升级数据格式时，先写新文件，再切换读取入口', 'R02',
    '纸上画出旧数据文件A、新数据文件B，以及写着A文件名的current文件。如果B写好了，但还没把current改成B，read()会读到哪个版本？先写下预测，再运行本步测试核对。',
    '把旧对象转换成新格式、另存一个JSON文件、切换current，作为一整套操作理解。另存成功后仍要切换入口才生效；旧文件保留，转换或切换前报错时仍可读取旧数据。',
    '测试在切换current前主动抛错，read()仍返回版本1；成功升级后read()返回版本2并含title字段，而旧文件仍是版本1。这里验证的是指定位置抛异常，不是真正断电。',
    '在VS Code给beforePublish()和renameSync(...)设置断点。打开tests/007-generation.test.mjs，用“Bun：当前测试”启动。停在beforePublish()时，用调试控制台执行this.read()，再用F10继续：抛错那次不会走到renameSync，仍读旧数据；成功那次跨过renameSync后再执行this.read()，应读到新数据。测试包含多次publish，结合调用堆栈辨认初始化、故障和升级这三次调用。',
    '合上材料，用两个JSON文件和一个current文件讲清顺序：先转换、再另存、最后切换。再解释为什么目录里已经有新文件，read()仍可能返回旧版本。',
    '给1→2的转换函数故意返回version:3，运行测试确认被拒绝、current仍选旧文件；再恢复正确转换并重新运行。次日闭卷重写转换函数与切换顺序，第3天再解释切换前抛错为什么不影响旧数据。',
    '对照原版Session的generation/checkpoint：generation在这里可理解为另存的一份数据，发布就是让current选中它。本步只实现自有JSON格式的转换与读取切换，尚未接入第005步应用，也不证明能升级原版历史会话。')
add('一份日志生成模型历史、fork 和冷搜索', 'R02',
    '把一个 text 分片和一条完整 assistant 消息放在一起，判断哪个该进入下一次模型请求。',
    '日志可以投影多个读模型。messages 只看已提交消息；fork 在新日志记录谱系与前缀；查询不启动 Agent。把“历史读取”和“恢复执行”分开。',
    '分片不进入模型历史；父日志长度不变；子会话只有指定前缀；搜索能命中而不调用模型。',
    '断在 messages.filter；暂时把 stream/text 也当消息，测试会出现多出的模型输入。',
    '合上代码，解释为什么读取历史不需要创建一个正在运行的 Agent。',
    '在父会话继续追加新消息，子会话的历史仍保持 fork 时的前缀。',
    'session projection/fork、session-query 的冷读职责。全文索引与分页将在后面继续加。')
add('忙时先排队，不把第二条任务丢掉', 'R02',
    '当前任务正在读文件，用户又发来“只修改src”和“做完再检查测试”。在纸上分别把它们放到step和turn队列，预测谁先被取走；先不写执行循环。',
    'Inbox只负责接收和排队，destination决定处理时机，不决定消息角色。step由后续执行循环在请求模型前检查，turn由Agent在空闲时开启新一轮。add/edit/remove/claim都记录到Session，pending重算未认领输入；认领后不能再编辑。本步测试只覆盖队列，不证明模型注入或进程重启恢复。',
    '两种目的地各取一条；恢复对象读到修改后的内容；重复 claim 为空，晚到 edit 报错。',
    '断在 claim 的 append；临时跳过 inbox/claim，测试应发现相同输入被再次取出。',
    '闭卷讲清turn和step分别由谁、在什么时机取出；画出接收、排队、认领、追加user消息、请求模型的顺序。不把认领等同于已经执行，也要能解释没有下一step时为何消息还留在队列里。',
    '先 enqueue 三条、remove 中间一条，再恢复并认领，顺序仍正确。',
    'agent-loop/inbox 的 next-turn/next-step 及队列编辑语义。')


add('从固定模型开始观察流', 'R03', '尝试写一个 yield 两片中文的生成器，再在两片之间取消。', '模型是异步事件接口，不是返回一个字符串。固定外部响应让流、工具、用量和停止原因可重复；真模型稍后只替换这个接口。', '按顺序收到 text/finish；hang 的首片后取消会拒绝下一次等待。', '断在 stream 的 yield 和 delay；去掉 signal 后取消测试会一直等待。', '闭卷写一个文字流，区分 request finish 和 turn end。', '把中文按字拆开，拼接结果仍一致。', 'llm/StreamChunk 的语义边界。')
add('工具声明与执行入口', 'R03', '给工具传错参数类型，证明执行函数没有被调用。', '模型看到 schema，宿主执行 run；所有入口统一进 execute，后续审批和嵌套代码也不能绕行。', '错参数不执行；注销后调用报未知工具；正确输入返回真实结果。', '断在 validate 与 guard；删掉 validate 后 runs 断言会失败。', '从模型参数讲到宿主副作用，画出校验和守卫顺序。', '增加多余字段，additionalProperties=false 应拒绝。', 'core/tools 的注册、schema 与执行消费者边界。')
add('第一次模型—工具—模型循环', 'R03', '先画出工具结果回到第二次请求时必须携带什么调用 ID。', 'turn 包含多个 step。请求输入、assistant 调用、行动前事实、工具结果按顺序提交；finish=tools 要继续，stop 才是正常完成。', '真实 sum 得到 5，模型被调用两次，第二次历史包含 call-1 的工具结果，turn/end 只有一次。', '断在 tools.execute 与第二次 model.stream；删掉 callId 后关联断言失败。', '关材料重写循环的主干，解释为何工具错误也必须有结果位置。', '把 sum 改成抛错，第二次模型仍看到明确失败结果。', 'agent-loop 的 assistant-stream/tool-calls 与请求事实。')
add('排队、取消和下一轮继续', 'R03', '第一轮首片到达时排第二轮，同时取消第一轮。预测两个结束原因。', 'Agent 拥有活动和 AbortController，Inbox 接收输入；每轮创建新 signal 和配置快照。取消当前活动后，未来已接受任务仍能执行。', '结束原因依次 cancelled/completed，两个请求分别用 first/second 配置，close 后没有活动。', '断在 cancel 和 pump 的新 AbortController；复用旧 controller 会使第二轮立刻取消。', '闭卷讲出 signal、轮次配置和队列各自归谁。', '同一轮连续点两次取消，仍只有一次 turn/end。', 'agent-loop 的运行身份、输入调度和取消收敛。')
add('并发工具与独占屏障', 'R03', '两个只读任务不同速度完成，中间插入一个写任务，先预测合法执行图。', '工具只有明确 exclusive=false 才可并发；独占前等待前组、独占后才开后组。结果按调用序提交，完成顺序不改变身份关联。', '0/1 并发，2 在二者结束后开始，3 等2结束；结果顺序仍0/1/2/3。Loop 增加批次入口但保留行动前日志。', '断在 Promise.all(group)；删掉屏障，start2/end0 的断言会失败。', '画出两个并发组和一个独占节点，再闭卷写调度。', '让第一个并发任务失败，第二个仍结算，后组仍按屏障执行。', 'agent-loop/tool-calls 的并发安全声明和独占序列。')
add('先还原字节，再谈模型事件', 'R03', '把你好按单字节切开，直接 decode 每块，看看会丢什么。', 'TCP 字节块、UTF-8 字符、SSE 帧和模型语义事件是四层。TextDecoder 保留半字符，空行决定完整帧，多行 data 需要合并。', '单字节中文与CRLF正确；多行data合并；尾帧不完整明确报错。', '断在 decoder 与 buffer；去掉 stream:true，中文断言会失败。', '合上代码解释为何一次 read 不等于一条 JSON。', '同一块中放三帧，顺序和内容均不变。', '原生 llm 传输解析边界。')
add('通过OpenAI兼容接口接入DeepSeek', 'R03', '沿用第015步SSE接口，把两条delta.tool_calls中的参数字符串拼成一个JSON对象；先预测缺少[DONE]时应成功还是报错。', '使用Chat Completions协议：Bearer鉴权、function工具定义、tool角色回复。正文与推理分别收集，工具参数按index拼接；finish_reason和[DONE]共同确认完整结束。Loop仍只接收Part，不需要了解线上字段。', '固定HTTP字节流正确组装中文与交错工具参数，保留usage和推理回放；两次请求间工具真实执行，结果与reasoning_content进入下一请求；截断、错误停止与取消均不冒充完成。', '在VS Code断在raw === [DONE]的判断、delta.tool_calls循环、JSON.parse(call.json)及toMessages；观察分片如何按index积累。删掉reasoning_content保存后，工具续轮测试必须失败。', '闭卷画出响应字节→SSE数据→delta→Part→会话事实→下一请求历史；说清工具结果为什么使用tool_call_id。', '把工具参数拆成三段，交错另一工具的分片；再去掉[DONE]，确认不会执行未确认完整的调用。', '自写DeepSeek的OpenAI兼容适配，用户选定此协议；不声称与原版Messages及推理签名等价。Files仍为独立协议示例，图片与上传接线需另行验收。')
add('上传与复用模型文件', 'R03', '相同图片同时用于两个请求，先实现只上传一次。', '内容hash、有效期、进行中的Promise各有职责。失败不能进入缓存，刷新不能把账号其他文件删掉。', '首次500明确失败；并发重试上传一次，两个请求得到同file id。', '断在 inflight.set/finally；故意不清理失败Promise，第二次永远失败。', '闭卷解释cache与inflight为什么不能共用一张表。', '把时钟移到过期前30秒，必须重新上传。', 'llm-deepseek/files-api 的上传复用与刷新边界。当前测试没有证明真API配额回收。')
add('把模型路由、重试和凭据刷新真正装进Agent', 'R03',
    '先预测：第一次模型请求在首片前失败一次，重试后要求调用sum，再带结果请求模型，这一轮分别有几次HTTP尝试、几条request/start、几次工具执行？',
    '新增routes-demo把Agent、Routes、DeepSeekModel、SSE和Tools串起来。前5场景验证路由与重试，第6场景用两个独立Agent共用RefreshToken，在构造模型鉴权头前调用get；Promise屏障稳定复现并发过期，刷新并保存后才发请求。外部HTTP和刷新响应固定，不读取真实凭据。',
    '直接运行demo，六场景reason依次completed/completed/error/error/error/completed；第1轮3次HTTP、2条request/start、sum执行1次；第6场景两个get、刷新1次、保存1次、模型HTTP2次，两个请求头均验证使用新凭据；退出后Agent关闭且路由/工具/监听均清空。',
    '实际demo用本页“018路由演示（附加）”配置连接终端启动的Bun；断在routes.stream的路由查找、published判断，以及demo的HTTP计数与sum执行。第6场景再断在RefreshToken.get的pending ??=、demo的beforeRelease和鉴权头布尔校验，观察刷新1次且放行前HTTP为0。下面的当前测试步骤只调原有Routes测试，不会自动附加到demo子进程。',
    '合上材料画出Agent→Routes→token.get→DeepSeekModel→HTTP与Loop→Tools两条链；解释为什么3次HTTP只执行1次工具，以及为什么两个并发get只刷新一次。',
    '临时把RefreshToken的pending ??=改成pending =，预测并验证第6场景因重复刷新而失败，再恢复。之后把模型名写错，确认没有HTTP请求也没有自动换默认模型。',
    '模型路由、有限重试及鉴权前的RefreshToken已接入demo并由实际模型请求头验收。远端OAuth刷新服务仍由本地回调固定提供，没有真实授权登录或加密存储；错误分类、持久attempt与完整鉴权矩阵仍待补齐。',
    run='bun src/routes-demo.mjs\nbun test ./tests/018-routes-demo.test.mjs\nbun test ./tests/018-routes.test.mjs', test='tests/018-routes.test.mjs')
add('上下文压缩与大结果原文', 'R03', '读一份大结果后，尝试只给模型短预览，同时保留原文可读取位置。', '压缩只改变模型可见副本，历史不变；保留当前完整轮次。Spill以内容hash定位原文，读取时再次核验完整性。', '旧历史仍500字符，当前轮保留；原文读回一致，篡改文件被发现。', '断在split和Spill.get；把recent裁掉半条工具消息，设计断言拒绝孤立结果。', '闭卷解释模型上下文、持久事实与Spill原文三者关系。', '当前轮自己就超预算时拒绝，不截掉工具调用组蒙混过去。', 'compaction/token-meter/spill；本步measure由调用方提供，字符数测试不代表生产token估计。')
add('把PiModel接进Routes，仍调用DeepSeek跑通工具续轮', 'R03',
    '先画两条链：Loop经手写DeepSeekModel访问模型，以及Loop经PiModel和pi-ai访问模型。假设远端仍是DeepSeek，指出究竟替换了哪层，再对照本步固定HTTP测试。',
    'pi-ai是访问模型的SDK，DeepSeek是远端模型服务。新增pi-demo真正向Routes注册PiModel，Agent持有Routes；SDK承担HTTP和流解析，Harness仍拥有Loop、工具与会话。先跑固定HTTP贯通，再沿用016的.env加--live请求DeepSeek；只有显式live才访问网络。',
    '新CLI入口实际走通两次模型请求和一次sum执行，第二次历史含SDK replay、推理及关联工具结果，最终5、completed，清理后路由/工具/监听归零。自动测试运行固定HTTP，真实请求以mode=live的独立记录验收。',
    '用本页020 pi-ai附加配置连接终端启动的pi-demo，断在Routes查找、PiModel.context及done、sum.run和第二次HTTP观察点。确认路由对象是PiModel，远端provider仍是deepseek。下面原有当前测试步骤只调适配器单测，不自动附加到CLI子进程。',
    '合上材料说清DeepSeek、DeepSeekModel、pi-ai和PiModel各负责什么；解释换SDK为何不一定换模型，以及SDK为何不接管Loop和工具执行。',
    '先预测删除toolResult回传会在哪一步失败，再在自己的工程临时改坏并运行固定demo，必须由第二次HTTP校验拒绝，恢复后重跑。真实模式缺Key必须失败，不回退固定响应。',
    'PiModel已经接入独立Routes/Agent入口，并有真实DeepSeek两轮工具链证据。其他协议、提供方、跨适配器旧历史、完整取消和产品发布矩阵仍需专门验收，不把当前样本记为全provider等价。',
    run='bun install --ignore-scripts\nbun src/pi-demo.mjs\nbun test ./tests/020-pi-demo.test.mjs\nbun test ./tests/020-pi.test.mjs', test='tests/020-pi.test.mjs')
add('真实文件与观察版本', 'R04', '两次读取相同文件，再用旧版本写入，先预测哪一次应拒绝。', '文件路径、真实链接和内容版本组成读写边界。写后观察失效，下一次修改必须再读；本步只保证同进程串行，不伪称跨进程CAS。', '中文空格路径可写读；旧版本失败；指向工作区外的链接不能读。', '断在realpath和current比较；删版本检查，stale写入测试应失败。', '闭卷画出先读、外部变化、条件写的时序。', '真实创建指向外部目录的链接，在链接下新建文件也必须拒绝。', 'fs seam/observed-version；路径检查不是OS沙箱，TOCTOU仍由更强执行边界解决。')
add('文件编辑默认唯一匹配，显式replaceAll才全部替换', 'R04',
    '文件内容为x x，预测不传replaceAll、传false、传true三次独立编辑的结果。再想一想，全量替换能不能沿用已经写过一次的旧version。',
    'read/write/edit仍经过统一工具入口。replaceAll是可选boolean，省略或false要求唯一匹配，true允许全部非重叠匹配；空查找串、零匹配和旧版本仍拒绝。新文本按字面构造后只写一次，保留LocalFS的版本与串行化边界。',
    'edit-demo实际展示默认拒绝、全量成功、旧版本拒绝、重新读后唯一替换。6项文件测试覆盖可选/false兼容、true多处替换、字面$&及删除、错误类型、空串/零匹配及外部修改保护。',
    '断在file-tools.mjs的版本比较、split后的matches和fs.write。观察同样两个匹配在默认模式被拒绝、true时继续，写后旧version仍被拒绝。实际demo的Bun附加命令和配置见本页。',
    '闭卷解释为什么replaceAll不能变成必填，为什么全部替换仍需要版本，以及pieces.join如何保留after里的字面$&。',
    '把before改为不存在的字符串，或把replaceAll改成字符串true，应明确失败且文件不变；恢复后重跑。删除文件后的旧版本编辑仍应失败，不能悄悄新建同名文件。',
    'fs-tools的统一执行、字符串匹配与版本边界。本步增加显式全量替换；不据此声称支持自动冲突合并、多文件事务或跨进程CAS。',
    run='bun src/edit-demo.mjs\nbun test ./tests/022-edit.test.mjs')
add('一次审批只唤醒一次调用', 'R04', '取消一个等待中的问题后，试着用旧ID点允许。', '审批身份和owner共同定位等待对象。先挂pending和取消监听再publish，才能处理同步答复；取消、超时、迟答必须清理同一状态。', '其他会话拒绝，取消后pending清零，迟答失效；同步publish内允许也正常完成。', '断在finish；把pending.delete移到最后，观察双答复是否重复结算。', '闭卷写出审批的创建、答复、取消、过期四条路径。', '两个不同审批交错答复，不得唤醒错误Promise。', 'interaction/user-approval 的关联和清理。')
add('所有工具执行前都过权限门', 'R04', '把读写工具分别放在read-only下，尝试找到绕行入口。', '效果read/write/execute/network和会话策略共同决策。权限事实先记录，等待审批后再次检查signal；OS confinement仍另有执行边界。', '拒绝write后计数为0；只读策略在执行之前拒绝；日志记录决策。', '断在Tools.guard与审批返回处；直接调用run会绕过守卫，正式入口不能这么做。', '闭卷解释审批允许后为什么还要检查signal。', '在允许按钮与真实执行之间取消，工具副作用不得开始。', 'permission-presets、user-approval和执行守卫分层。')
add('运行真实进程并收回进程树', 'R04', '执行退出码3的程序，区分成功启动和成功执行。', 'Subprocess接受显式Spec与argv，输出、超时、取消、进程树由提供方负责；不通过shell字符串拼接。', '真实code3和ok被保留；100KB输出被拒绝；等待程序可超时和取消。', '断在spawn、stop、close；删掉signal监听，取消场景会等超时。', '闭卷讲出发SIGTERM与真正收到close的区别。', '创建子进程的程序被取消后，在目标OS核对整个树已退出。', 'subprocess-local 的Spec与进程生命周期；Windows进程树需要真实目标机验收。')
add('保持Shell状态并串行执行', 'R04', '第一条export，第二条echo，先用两次独立spawn观察变量为什么没了。', '持久Shell是有状态资源；随机边界标记、单命令队列和进程所有权组成契约。取消后结束整个Shell，不复用未知状态。', '真实Bash跨调用保留变量，sleep可取消，close等待进程退出。', '断在marker解析；把两个run改成并发写入同一stdin，观察归属错乱。', '合上材料解释持久Shell和显式argv进程分别适合什么。', '在一轮cd到含空格目录，下一轮pwd应保持状态。', 'shell/bash-local 的持久执行语义；本步尚非PTY终端，下一步补。')


add('补上真正的PTY终端', 'R04', '先打印process.stdout.isTTY，比较管道Shell和PTY。', '终端是有窗口尺寸、键盘输入、信号和输出游标的交互资源。Bun.Terminal直接提供PTY，自己的Terminal负责owner、连续中文解码、输出EOF和进程退出。', '真实PTY中isTTY=true；退出事件可等待；读到当前游标后再读为空。', '断在data回调和scope清理；去掉kill后运行一个长驻程序，退出检查会卡住。', '闭卷说出管道Shell和PTY的三项差别。', '把窗口从80x24改100x30，在交互Shell中读取stty size。', 'terminal与subprocess-local的PTY边界；各OS原生库仍需目标环境验证。', 'bun test ./tests/027-terminal.test.mjs')
add('让OS沙箱缺失时明确拒绝', 'R04', '尝试在沙箱依赖不存在时执行echo，判断应该降级还是失败。', '本步将政策编译为Seatbelt/bwrap的真实执行Spec，保持命令参数分离。它与前面的路径校验和审批不是同一层。Windows ACL后端尚未实现，记录缺口而不伪造。', '探测失败拒绝；支持后端生成带限制的Spec；未知平台失败关闭。这里的编译测试不证明真实OS效果。', '断在probe与wrap；删掉拒绝分支会使测试发现裸执行Spec。', '合上材料解释为什么审批允许也不能去掉confinement。', '在真实目标系统把Spec交给execute，分别测试工作区内写和越界写，记录实际退出码。', 'sandbox-policy/sandbox-local与native/system；Windows后端是明确未完成项。')
add('把文件和执行放到同一个SSH世界', 'R04', '给文件名加入单引号和分号，先验证它不会变成第二条Shell命令。', '远端提供方同时管理文件与执行，Host配置主机，模型不能拼接ssh选项。POSIX引用需要按Shell编码，不是JSON.stringify。', '真实Shell往返带引号参数无损；读写Spec使用同一个远端；../被拒绝。未连接真实SSH时不得记远端集成通过。', '断在quote和run；临时去掉单引号编码，带分号样本会暴露注入。', '闭卷画出本地Host、SSH进程、远端Shell和远端文件系统。', '在自己的隔离SSH服务器读写含中文和空格路径，取消长命令后核对进程树。', 'ssh的fs/subprocess/sandbox成套后端；本步尚未取得完整远端隔离资格。')
add('后台Job的wait和kill分开', 'R04', '启动一个长任务，wait只等10毫秒，看看生产方是否应结束。', 'Jobs拥有生产方signal和状态，调用者wait只观察。输出游标、owner、结束通知、scope清理是同一资源契约。', 'wait超时仍running；跨owner读被拒绝；kill后cancelled；关闭scope任务表清空。', '断在wait的Promise.race和kill；把wait超时也abort，测试立即失败。', '合上代码解释为什么wait超时不代表任务失败。', '一个owner启动两个Job，关闭owner后两者都停止。', 'jobs服务的所有权、wait/kill与生命周期。')
add('Skill按需加载并记录请求来源', 'R05', '用户层和项目层放同名Skill，先预测谁胜出。', '发现目录不等于加载正文。加载时把来源、hash和内容入事实，修改磁盘不会悄悄改变旧请求。规则和Skill都不能自行获得执行权限。', '项目层胜出；修改源文件后旧上下文事实仍是project。', '断在load与append；把日志只记path，再修改文件，旧请求将不能解释。', '不看材料画出发现、选择、加载、注入请求四个动作。', '删掉一个目录后重新discover，旧项不能继续装作存在。', 'skill/context/system-prompt的来源与回放。')
add('先实现一个可调试的双向RPC', 'R05', '同时发请求和通知，让服务端反向请求客户端，先标清两个ID的主人。', 'Peer管理等待、错误和断连，framing只管理字节。NDJSON与Content-Length使用相同Peer；审批等反向请求无需第二套连接。', '中文LSP字节帧正确；未知方法返回关联错误；断连会拒绝等待并清空计时器。', '断在receive的method/id分支；用字符长度代替字节长度会破坏中文LSP帧。', '闭卷画出request/result/notification/error四种消息。', '将一帧拆成多个字节块再送入readable，结果相同。', 'SDK/ACP/MCP/LSP各自线协议；这个Peer不冒充原版Typert codec。')
add('真正通过MCP发现和调用外部工具', 'R05', '让外部服务分页返回两个工具，先检查你是否只读了第一页。', '真实SDK负责MCP，自己的mount负责命名、工具注册、owner、分页、代次更新和撤销。工具调用继续经过Tools.execute和权限守卫。', '跨进程握手成功，两页工具均发现，真实callTool返回second，close后工具表为空。', '断在nextCursor和contribution.close；去掉循环只会发现first，测试失败。', '合上材料画出Tools→MCP Client→stdio→Server→结果。', '服务发tools/list_changed后刷新，旧代工具必须撤销；断连后不能继续用旧Client。', 'mcp-client的多服务/分页/资源/代次；生产重连和失败回滚还需更完整样本。', 'bun install --ignore-scripts\nbun test ./tests/033-mcp.test.mjs')
add('网页抓取、来源与网络边界', 'R05', '让第一页重定向到第二页，先检查每一次跳转是否重新验URL。', '抓取、搜索、网络政策和展示文本分开。正文有字节/超时上限，密钥是宿主配置；抓取内容是不可信资料，不当系统指令。', '真实本机HTTP跳转取得中文正文，脚本内容不会进入显示文本；生产默认拒绝私网。', '断在redirect与check；跳过重定向验证会造成目的地策略旁路。', '闭卷解释抓取结果为什么不能直接innerHTML。', '外部服务连续跳转超过上限，明确失败而非无限等待。', 'web-search/web-fetch；DNS重绑定与代理隔离仍需网络执行边界加固。')
add('语言服务走真实进程和文档版本', 'R05', '打开文档后再改一行，预测definition请求看到哪一版。', 'LSP是一个拥有文档生命周期和能力表的进程。复用Content-Length传输，initialize/didOpen/didChange/query/shutdown顺序不可乱。', '真实外部进程握手，定义查询返回文件URI与range，关闭执行shutdown/exit。固定对端不代表真实语言语义已通过。', '断在open/change的version和peer.request；对比URI与本地相对路径。', '合上材料解释为什么只启动语言服务器还不够。', '把spec替换为本机typescript-language-server --stdio，查询真实项目中的符号定义。', 'lsp服务/提供方/工具分层；生产服务器的启动回滚、取消、诊断版本尚需补齐。')
add('子Agent可以继续对话', 'R05', '同一个子任务分两次发消息，先检查第二次是否还保留第一轮历史。', 'Subagent是父scope拥有的Agent资源，create/send/wait/interrupt分开，观察控制检查父身份。执行用自己前面写出的Agent。', '两个真实turn共用子Agent历史；其他父身份被拒绝；父scope关闭后子资源清空。', '断在get与factory；每次send都new Agent会丢失历史，新增断言发现。', '闭卷画出父子所有权与控制/输出两条方向。', '第一轮取消后继续子会话第二轮，仍能完成。', 'subagent的持续委派；外部ACP/worker后端与冷恢复还没有等价证据。')
add('有依赖的工具工作流', 'R05', '构造a依赖b、b依赖a，确认任何副作用之前就发现循环。', 'DAG先整体校验再执行，ready组可并行；节点运行仍通过统一Tools。预算限制在行动之前检查。', '乱序节点按依赖执行a/b；循环拒绝，已执行计数没有增加。', '断在visiting与ready；删掉循环校验会卡住while，保留90秒超时诊断。', '闭卷写出拓扑校验和ready组的区别。', '给两个互不依赖节点加入不同延迟，结果仍按身份保存。', 'workflow服务的依赖、预算与工具执行边界。')
add('程序化调用也不能绕过工具守卫', 'R05', '让第二条指令引用第一条结果，统计审批守卫进入几次。', '先实现有界寄存器程序，把引用、预算和嵌套工具调用练熟。它不是原版任意JavaScript/Python run_code沙箱；那部分仍是缺口，不能用eval替代。', '结果被后续指令引用，两个内层调用均过守卫；超预算在执行前失败。', '断在$ref和tools.execute；直接调用tool.run会让checks断言失败。', '闭卷讲出嵌套工具调用为何仍归当前会话权限。', '引用未来或缺失寄存器，应拒绝且不运行该工具。', 'ptc-runtime的能力绑定基础；任意代码运行时尚未实现，完整复刻不能勾完成。')
add('Todo、Plan、Goal、提醒和反馈', 'R05', '把一条待提醒记录恢复两次，先保证它不会在正常重启后重复投递。', '每种协作域保留自己的状态机。提醒按持久id投递，投递方负责幂等；反馈是sidecar事实，不自动混进模型对话。', '重建后只投递一次；反馈不进入messages；Plan不能接受Goal的completed状态。', '断在due的deliver与set之间；在这里制造崩溃，证明为什么外部投递仍需id幂等。', '闭卷解释Todo完成、Plan评审通过与Goal完成的不同。', '设置未来提醒和已过期提醒，只投递到期项。', 'todo/plan/goal/schedule/feedback；自动持续Goal驱动仍需完整接线。')
add('附件先落盘，交付保留当时快照', 'R05', '交付一个文件后马上修改原文件，预测旧turn应该展示哪个内容。', '内容寻址、附件引用、下载授权与交付事实分开。文档转换必须调用真实转换器，不能换扩展名冒充PDF。', '交付快照仍为first；非法hash拒绝；改变原文件不改变已记录附件。', '断在save与session.append；把顺序颠倒会留下指向尚未持久化内容的事实。', '闭卷画出上传、持久化、用户消息、下载四个边界。', '篡改内容文件后read必须报完整性错误；超大上传在写入前拒绝。', 'attachment/document/deliverables；Office引擎、图片像素校验和逐turn修改diff仍未完全对齐。')


add('把已有领域装成一个持久Host', 'R05', '创建两个会话，关闭一个，先证明另一个还在运行。', 'Host只装配已有Session/Journal/Agent/Tools/Guard，冷列表不创建Agent；恢复中断轮次标记UNKNOWN，不自动重做副作用。', '双会话owner隔离；关闭后恢复消息；读取列表不调用模型；最后无锁残留。', '断在open恢复判断和closeSession的finally；制造未结束turn后重启，观察interrupted。', '闭卷画出Host持有哪些对象，哪些对象持有文件句柄。', '一个会话进入审批时关闭它，另一个会话仍能继续。', 'Agent server与Session store装配；本工程日志仍是自有格式。')
add('产品数据和秘密不混进对话', 'R06', '保存一把Key后调用list，检查响应能否找到明文。', 'Store、CredentialRef、Workspaces各有持久域。文件原子替换，凭据在宿主解析，客户端只得到configured描述。', 'Key不出现在list；重建对象仍能解析；工作区归档状态恢复。', '断在Credentials.list与resolve；把secret也返回list，安全断言立即失败。', '合上资料解释CredentialRef和明文Key分别在哪一层。', '删除Key后新请求失败，正在进行的请求仍使用已准备输入。', 'storage/settings/credentials/workspace；账号OAuth和访问控制还需后续完善。')
add('外层共用领域控制器', 'R06', '让两个不同principal读取同一个sessionId，先让服务端拒绝越权。', 'Remote只映射方法到Host。订阅、提交、等待、取消、审批各有调用；断开订阅不暗中取消任务。该协议是本工程自己的，尚非原版Typert互操作。', 'prompt真实执行，收到事件与完成；陌生owner被RPC拒绝。', '断在session函数和Host.header；去掉owner检查，越权测试会失败。', '闭卷画出prompt响应、流通知、取消请求三条方向。', '断线后让任务完成，再按after游标重连读取剩余事件。', 'api controllers与Connection Remote职责；原版Typert codec/公共方法表是待对齐项。')
add('Bun原生SDK驱动同一个Host进程', 'R06', '不用直接import Agent，启动一个子进程并通过RPC完成任务。', '高层SDK负责进程所有权、订阅、接收和等待，服务端仍用前一步控制器；EOF结束时Host清理会话。', '跨进程收到通知、结果与落盘事件；close后子进程被回收。', '断在spawn和session.wait；不要把宿主断点误设到SDK父进程。', '合上代码讲清stdout、stderr各放什么。', '让服务端提前退出，所有pending请求都应明确失败。', '原生sdk protocol/client/server的三层职责；当前自有协议不是原版兼容声明。')
add('Python SDK也走同一条协议', 'R06', '先从Python发送一个NDJSON请求，检查中文是否保留。', 'Python不重写Agent，只负责子进程、请求关联、通知读取线程和关闭。读线程能同时接收通知和任意顺序的响应。', '真正Python进程启动Bun，完成一轮并读取assistant事实，所有子进程退出。', '断在Python _read和request；故意先写stdin后登记pending，快速响应可稳定暴露竞态。', '闭卷画出Python调用、Bun Host与模型三种执行边界。', '让Bun服务端断开，Python等待者收到连接错误而非永久挂起。', 'Python SDK协议与运行时所有权；wheel分发/原版协议互通尚需单独验收。')
add('自己的ACP粘合层驱动同一个Host', 'R06', '先把一次prompt和一次request_permission的调用方向画出来。', '使用真实固定ACP SDK，自己的适配器处理多会话、持久列表/恢复/关闭、配置、语义更新和反向审批。text-only如实声明，不把未支持图片广告成支持。', '真实跨进程握手、文字输出、反向审批写文件、取消、list/close/resume通过。', '断在session/prompt与approval事件；stdout混入debug会破坏协议，改走stderr。', '闭卷串起ACP SDK→glue→Host→Agent→模型→提交消息→ACP update。', '两个会话同时运行，只取消其中一个；另一个不受影响。', 'dsh-acp当前全方法面；本步仍缺图片、完整能力配置和请求级取消等原版细节。', 'bun install --ignore-scripts\nbun test ./tests/046-acp.test.mjs')
add('认证后的WebSocket复用领域Remote', 'R06', '不带cookie访问服务，再用启动凭据交换cookie，比较401和302。', 'HTTP只负责本机认证与静态资源，WebSocket把消息交给同一个Peer/Remote。Host/Origin检查、慢消费者和断连清理属于传输边界。', '真实HTTP401/凭据交换302；WebSocket创建真实会话。此步还没有页面，首页认证后404是预期。', '断在authorized与upgrade；用别的Origin，握手必须被拒绝。', '合上材料解释WebSocket断开为什么不等于Agent取消。', '伪造Host或跨域Origin发送相同cookie，仍然不能获得接入。', 'Web server/Connection/uplink职责；自有WebSocket协议尚非原版Typert wire。', 'bun install --ignore-scripts\nbun test ./tests/047-http.test.mjs')
add('先写重连读模型，再画页面', 'R07', '先送seq1再送seq0，同一事件再送一次，预测最终显示。', 'Client按seq折叠事实，generation隔离旧连接，snapshot与notification可交错。审批是派生状态，settled后刷新不能复活。', '乱序暂存后顺序接纳；重复文字不追加；旧连接消息拒绝；新连接结算审批。', '断在waiting和generation；删去generation判断，旧连接会清掉新审批。', '闭卷写出seq和generation分别解决什么。', '在快照到达前先收到实时seq，再补快照，最终历史只出现一次。', 'client connection/journal/projection与viewing state分离。')
add('把真实Web操作接到同一个Agent', 'R07', '在浏览器输入/tool read，先从Network找出执行实际发生在哪里。', '页面只显示事实与发送控制请求。发送、排队、steer、取消、审批、标题、归档和权限都复用已有控制器。工具内容只用textContent。', '自动测试证明认证后页面/模块可达；随后手工创建工作区会话，读文件、写文件审批、取消和刷新。缺Key时明确标注离线演示。', '按本章末尾在 VS Code 启动 Web：Bun Host，再启动 Web：页面；web/app.mjs 的 rpc/render 断点属于页面，src/remote.mjs 的 session.submit 断点属于 Host。', '闭卷从点击发送讲到事件返回视图，指出Key为什么不应该进浏览器历史。', '两个窗口订阅同一会话，刷新其中一个不应重发旧prompt。', 'Web真实产品面的起步；Markdown/工具diff/全量面板/槽位等仍需逐项补齐。', 'bun test ./tests/049-web-assets.test.mjs\n# 人工验收时另开终端运行：HARNESS_HOME="$PROJECT/.data-web" bun src/web-server.mjs')
add('模型设置、队列编辑和真实文件面板', 'R07', '保存一个模型ID，再发新任务，先检查实际请求是否使用它。', '设置必须穿过持久Store和请求快照，Key只写入宿主。文件面板仍走Tools守卫和observed version，队列只允许编辑未认领输入。', '设置重启恢复；未知backend明确失败；页面可读/条件写，写入仍出现审批。', '断在product路由和file.write；给旧version保存，必须拒绝而非覆盖。', '关闭材料解释模型设置、当前请求快照和凭据引用三者关系。', '两个窗口先后编辑同一文件，第二个旧版本保存应失败。', 'settings/models/credentials/queue/files多领域接线；配置层级与全provider还未全部对齐。')
add('把已经写出的能力纵向接入工具', 'R07', '用同一个Agent调用todo_update，检查状态是实际改变还是只打印成功。', '本步组合已有Jobs/Skill/Web/Workflow/Program/协作/子Agent/附件，所有工具仍走一个Tools与权限门，父Agent取消传播给受管子Agent。', '完整Agent调用todo_update改变持久状态；工具表包含子任务入口；子scope清理。搜索等外部能力未配置时明确失败。', '断在add工具注册和tools.guard；拒绝审批时协作状态不得改变。', '闭卷画出每个工具的service/provider/consumer，不按文件名背名词。', '关闭有子Agent和Jobs的父scope，核对所有生产方与句柄归零。', '工具纵向完整性：schema、执行、权限、事实、清理；这仍不等于全部原版工具等价。')


add('Electron只做桌面边界，不再复制Loop', 'R08', '先画Electron main/preload/renderer与独立Bun Host的边界。preload运行在Renderer进程，不另算一个进程。', '固定Electron通过显式Bun路径启动同一个Web Host，Renderer隔离与固定IPC白名单；单实例锁先于数据访问，退出等待Host清理。开发模式显式传Bun路径，安装产物携带Bun。', '路径/深链接单测通过；手工bun run desktop后创建会话、读写、审批、取消、退出重开。单测没有启动窗口，不能因此勾GUI验收。', '按本章末尾的 VS Code 步骤：HARNESS_VSCODE_DEBUG=1 bun run desktop；先附加 Electron：Main 并继续，再分别附加 Electron：Bun Host 与 Electron：Renderer；断点必须对应所在进程。', '闭卷解释为什么preload不能暴露任意fs/spawn。', '关闭窗口再打开；在macOS窗口关闭和应用退出应有不同生命周期。', 'desktop/desktop-host的进程所有权；当前缺独立desktop profile/完整依赖图管理和全量原生产品面。', 'bun install --ignore-scripts\nbun scripts/install-electron.mjs\nbun test ./tests/052-desktop-policy.test.mjs\nbun scripts/smoke-desktop.mjs\n# 人工操作窗口：bun run desktop')
add('账号PKCE与快捷键数据边界', 'R08', '篡改OAuth回调state，验证换票之前就拒绝。', 'PKCE把授权码绑定到本次本机尝试，回调单次消费；快捷键文件遇到坏格式拒绝写回，不悄悄丢用户配置。账号后端必须真实配置。', '真实密码学挑战、state拒绝和单次换票通过；快捷键服务能保存并保留未知版本。当前模块还未接入桌面欢迎页与真实登录。', '断在exchange的state检查和consumed；把检查删掉，错state测试必须失败。', '合上资料区分模型Key、账号token与桌面浏览器cookie。', '交换失败后重新发起全新尝试，旧state仍不可复用。', '账号凭据、欢迎页、PKCE和shortcut服务；登录/撤销/深链接/UI接线未全部实现。')
add('运行时下载必须验证后发布', 'R08', '把下载内容改一个字节，证明安装目录没有因此变成新版本。', '可信锁、hash、暂存目录、原子发布、依赖路径构成离线运行时边界。workspaceDependencies只返回载荷内路径，不能找不到就退回PATH。', '真实缓存写入和篡改拒绝通过；安装函数提供校验/归档路径检查/原子发布。Node/Python/pnpm/Office完整锁与载荷本步尚未备齐。', '断在hash判断与rename；把发布移到校验之前，损坏载荷会被误认作安装完成。', '闭卷画出下载、校验、解包、冒烟、发布五个状态，并指出当前缺少的资格。', '在没有系统Bun/Python的目标机验证依赖路径；未准备完整载荷时必须记阻塞。', 'primary-runtime与tool-workspace-dependencies；本步只是安装机制，不冒充原版完整离线运行时。')
add('更新签名、降级拒绝和失败保留旧版', 'R08', '改一字符manifest，再试着用原签名验证。', '签名验证原始字节，hash验证载荷，目标/版本验证资格。安装器失败保留旧版状态，awaiting-new-version-smoke不能当完成。', '真实Ed25519篡改拒绝；安装失败进入failed-keep-old。平台安装器与更新主机仍未集成。', '断在verify与apply；删hash检查，给tampered载荷新增失败断言。', '闭卷讲出签名、hash、安装结果、启动冒烟各自证明什么。', '合法签名但版本更旧、架构不同，仍然拒绝。', 'desktop更新资格与失败恢复；当前没有证明真实应用自动升级。')
add('生成本地安装产物，正式资格单列', 'R08', '先不打包，检查files里有没有自己的credentials和工作目录。', 'electron-builder只打产品文件并携带当前目标架构的Bun；每目标在原生主机构建。正式macOS/Windows签名缺证书就失败，unsigned只用于本地安装，不冒充分发资格。', '打包配置和资格检查通过。随后在macOS ARM64运行bun run package，检查产物再到干净测试机安装；本次自动测试不运行签名或发布。', '断在releaseTarget；删除凭据检查，会让无证书被错误记成正式发布。', '合上材料解释源码构建、应用打包、签名、公证、安装后运行分别是什么。', '在无node_modules/PATH工具链的机器安装，验证所有依赖来自载荷。', '桌面全平台发布生命周期；完整捆绑运行时、更新安装器与多平台验收尚未完成。', 'bun install --ignore-scripts\nbun test ./tests/056-release.test.mjs\n# 人工本机包：bun run package')
add('实验团队的名字和任务不靠内存猜', 'R09', '创建一个失败成员后，再用相同名字创建一次，先判断是否允许。', 'Team保留永久名字、Lead权限与持久任务板；消息进入已有Agent Inbox，不自行重发失败意图。任务依赖完成后才可认领。', '重复名字拒绝；依赖未完成不可认领；真实文件持久化owner与状态。', '断在provisioning和claim；先调用create再记录名字，失败会使名字被错误复用。', '闭卷画出成员状态和任务状态两张不同状态机。', '重建Team对象后继续认领下一任务，状态不丢。', 'experimental/agent-team；完整角色工具、冷恢复与模型Teams驱动未全部接线。')
add('可信Hook仍要走执行和权限边界', 'R09', '外部Hook返回allow=false，证明真实工具没有执行。', 'Hook默认关闭，显式配置后才运行；脚本参数走argv而非Shell拼接，改动参数后重新schema校验，最后仍进入原权限守卫。', '真正Bun子进程Hook拒绝后没有副作用；卸载恢复原守卫。', '断在Hook结果JSON解析和previous；去掉previous就绕过权限，必须另加拒绝场景回归。', '合上材料说明Hook与Skill的执行权限差别。', 'Hook改出错误类型的参数，执行前失败。', 'hook-protocol/Claude mods；本步仅before-tool Hook，其他时机和兼容层未全部实现。')
add('浏览器动作和系统动作分开', 'R09', '用隔离浏览器填入中文再点按钮，证明页面真实变化，而非只返回success。', 'Playwright打开临时profile，浏览器DOM动作与系统CUA分开。截图返回真实PNG，网络路由应用已有URL政策；系统动作只允许固定提供方命令。', '真实Chrome填表、点击改变data-done、PNG签名正确。缺Chrome就失败，不能全skip；系统权限动作未实测。', '断在route和locator；故意改错selector应失败，不返回模拟点击成功。', '闭卷区分网页DOM、浏览器进程和操作系统屏幕三个域。', '页面尝试访问私网，默认路由应阻止；实际OS截图需要授权后留证。', 'browser-use/computer-use；当前CUA动作/平台矩阵不全，Browser Worker与完整UI还未对齐。', 'bun install --ignore-scripts\nbun test ./tests/059-browser.test.mjs')
add('语音和翻译复用外部提供方边界', 'R09', '把一段音频作为FormData上传，检查它没有被塞进普通聊天文本。', '浏览器录音拥有媒体轨道，停止必须释放；ASR端点和凭据显式配置；翻译复用既有模型流与取消。', 'FormData/凭据和翻译流固定测试通过；麦克风、真实ASR和UI录音未实际验证。', '断在transcribe的HTTP与translate的finish；缺finish不能伪装成完整译文。', '合上资料说明录音、ASR、翻译、语音输出分别是哪项能力。', '拒绝麦克风权限或取消ASR，界面必须能恢复继续输入。', '实验voice/translation；实时音频、播报与产品接线尚未实现。')
add('Webhook通过持久输入去重', 'R09', '相同delivery重新发一次，证明没有多出第二条用户任务。', '签名验证原始正文，时间窗口防陈旧重放。接收身份和Inbox事实在同一日志提交，重启后仍能去重。', '签名篡改拒绝；重建接收器后重复delivery仍只pump一次。', '断在HMAC和inbox/add；如果先标已处理再入队，中间崩溃会丢任务。', '闭卷说明HTTP重试、持久接收与模型执行分别在哪一层去重。', '同delivery不同正文要拒绝而非执行新任务；添加这一契约回归。', 'experimental webhook；真实渠道适配、完整HTTP接入与签名方言仍需补齐。')
add('Worktree归档不自动创建提交', 'R09', '先尝试删除不归当前管理器拥有的worktree，应该立即拒绝。', '工作区创建用显式git argv，归档tracked和非ignored文件后才允许移除；不自动commit。命名与ref不能成为git选项。', '未拥有路径和恶意名称/ref在执行前拒绝。本步没有运行真实worktree创建/归档，需在你提供的隔离Git仓库留证。', '断在owned和tar；先删除再归档会丢工作，顺序不得调换。', '合上资料区分工作区目录、Git提交与未提交文件快照。', '创建中文/空格文件后归档并人工解包核对，ignored文件按约定另行保留。', 'experimental/worktree；当前恢复、已删除文件处理、Git上下文快照仍未完整实现。')
add('Worker是有配额的真实外部Host', 'R09', '运行一个独立子进程任务，检查它是否真正使用另一个home。', 'Worker复用Native SDK，隔离进程和数据目录，配额在启动前检查；scope关闭和取消负责回收。不是在主进程里包装Promise改名Worker。', '真实子Host完成任务，配额归还，超额拒绝。Browser worker runtime不是同一个后端，尚待实现。', '断在active.set和finally close；去掉清理，第二次会错误超额或残留子进程。', '闭卷画出worker父进程、SDK和子Host所有权。', '运行中取消，再检查子进程已退出，下一任务可正常启动。', 'worker/subagent后端生命周期；浏览器Worker与包内模块隔离还有差距。')
add('遥测失败不能拖垮任务', 'R09', '尝试把prompt和Key放进attributes，观察最终HTTP正文。', '默认关闭、字段白名单、有界队列、批次与超时组成数据出口。只发送OTLP结构，错误返回false，不向业务抛网络异常。', '真实JSON OTLP结构正确，敏感字段未发送，503不阻断业务。', '断在allowed过滤与flush catch；删过滤，secret断言失败。', '合上代码讲清用户消息、调试日志、产品统计分别能否发送。', 'Collector超时，任务仍应完成，队列有明确上限。', '共享OTel/统计/反馈策略；当前未实现全链Trace与原版产品遥测细节。')
add('插件市场是数据，执行必须显式装配', 'R09', '索引里放一个条目，确认列出它不会执行其代码。', '市场索引生成与本地可信插件安装分开；动态import后setup成功才提交状态，disable撤销Scope贡献。', '真正动态模块提供服务，卸载后服务消失；失败安装不提交状态。', '断在import/install/store.update；先写enabled再安装，会在重启时恢复半成品。', '闭卷串起发现、下载、安装、启用、卸载和重启恢复。', '同名插件更新失败，旧版本应保持可用；当前实现尚不满足，需要补事务更新。', 'boot/plugin-market/extensions；npm/Git安装、权限与原版bundle契约尚未完全实现。')
add('全文索引、ZIP和TypeScript公共契约', 'R09', '同一快照索引两次，证明搜索结果不会翻倍；再尝试未授权会话查询。', 'FTS是冷读可重建索引，不能误叫SQLite Session后端。ZIP只导出授权事实，解包先限大小/路径；SDK类型由真实TypeScript消费者编译验证。', '真正SQLite FTS去重/权限过滤、ZIP往返、NodeNext类型消费者通过。原版V4导入和原版ZIP格式仍未支持。', '断在indexed.seq和ZIP filter；删seq水位会出现重复结果。', '合上材料解释可重建索引为何不是事实来源。', '给ZIP放越界路径或超限文件，完整拒绝后不落盘。', 'session-query/导出/公开SDK类型；本工程自己的协议和格式不等于原版兼容。', 'bun install --ignore-scripts\nbun test ./tests/066-query.test.mjs')
add('让固定原版和自己的ACP跑同一组样本', 'R09', '先在纸上写下三轮期望：正常、首片后取消、同会话继续。', '原版只在独立oracle进程作为验收对象，自己的产品不导入它。两边外部模型固定，测试通道确认首片已经被Loop消费，再取消，避免sleep竞态。', '先运行本步归一化测试，再设置锁定原版目录运行真正compare-acp。三个样本必须实际相同；这不证明其他工具、格式、UI或平台等价。', '断在signature和firstPartial。保留partial与cancelled；把它们过滤掉会掩盖真实语义差异。', '关闭材料复述从输入到执行/输出/取消的全链，并指出还有哪些原版能力没有证据。', '加入并发双会话和审批失败样本，再扩展比较器；没有实际运行的样本不能算通过。', '完整复刻的契约差分起点；最终仍以34项差距逐条证据收口，不按代码量推完成比例。', 'bun test ./tests/067-comparison.test.mjs\n# 固定原版已安装依赖后：HARNESS_ORACLE_SOURCE="原版绝对目录" bun scripts/compare-acp.mjs')


add('最后亲自贯通浏览器与真实文件', 'R09', '先不看测试，用浏览器完成写文件审批、取消、下一轮和刷新四件事。', '这个验收不直接调用按钮背后的函数，而是启动真实Chrome、加载实际页面、经WebSocket控制Host。外部模型固定，宿主、UI、权限、磁盘和恢复都真实。', '浏览器真实写出proof.txt；首片后停止；下一轮继续；刷新后历史恢复；旧审批不复活；没有页面脚本异常。它仍不是原版全功能等价验收。', '在 VS Code 先启动 Web：Bun Host、再启动 Web：页面；分别给页面 rpc/render 和 Host 的 permissionGuard/runTurn 设断点，沿同一次 toolCallId 查全链。自动化测试会另开 Chrome，需要手工调试页面时按第049步的两个配置操作。', '关闭材料从空白画出UI、Remote、Host、Agent、模型、工具与持久化的领域边界。', '把允许换成拒绝，文件不得出现；再用两个窗口制造旧版本编辑冲突。', '最终产品纵向回归；完整复刻仍须把COVERAGE中未满足项真实实现并取得原版契约证据。')


add('最终CLI也接回同一个持久Host', 'R09', '从命令行读取一个真实文件，确认不是第000步的收到任务回声。', '保留原输入契约，CLI装配已有product/capabilities/Host，自己的审批和Ctrl+C只是UI适配；数据、执行、错误与关闭仍由领域层负责。', '真正CLI子进程读取真实工作区文件并以completed退出；Bun/ACP/Web/桌面继续使用同一领域实现。', '断在run和permissionGuard；CLI只打印成功但不读取文件时，正文断言会失败。', '合上资料，分别从CLI、Web、ACP、SDK走到同一个Agent，指出协议转换各自在哪。', '以同一home和HARNESS_SESSION恢复会话，再发后续任务；首片Ctrl+C后再启动可恢复历史。', 'CLI产品的纵向接线；原版profile/plugin命令、公共协议/历史数据/完整产品和发布资格仍在COVERAGE保持未完成。', 'bun test ./tests/069-cli.test.mjs\nbun run start \'/tool read {"path":"package.json"}\'')


if __name__ == '__main__':
    (ROOT / 'lessons.json').write_text(json.dumps(LESSONS, ensure_ascii=False, indent=2) + '\n')
