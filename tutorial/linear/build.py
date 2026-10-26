#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把独立实现的逐步增量编成教程；不读取或拆分原版源码。"""
import hashlib
import json
import shlex
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def main():
    """每步只展示本步文件，保留唯一前置、可执行命令和学习闭环。"""
    lessons = json.loads((ROOT / 'lessons.json').read_text())
    destination = ROOT / 'lessons'
    destination.mkdir(exist_ok=True)
    manifest = []
    for lesson in lessons:
        number = lesson['id']
        guide = lesson['guide']
        sources = sorted((ROOT / 'steps' / number).rglob('*'))
        files = [path for path in sources if path.is_file()]
        lines = [f'# {number} · {lesson["title"]}', '', f'阶段：{lesson["phase"]}。唯一前置：' + ('空目录。' if number == '000' else f'完成第 {int(number)-1:03} 步，继续同一个工程。'), '',
                 '## 什么时候会用到这一页', '', guide['scenario'], '',
                 '### 这次数据怎么走', '', '```text', guide['flow'], '```', '',
                 '### 对应时序图', '', '从上往下读；实线箭头表示调用或发送，虚线箭头表示返回或事件通知。`opt`表示可选操作，`alt`表示不同结果，`loop`表示重复，`par`及其`and`分支表示并行；“未接入”及fixture说明按图中标注理解。', '',
                 '```mermaid', guide['sequence'], '```', '',
                 '**当前接线位置：**' + guide['wiring'], '',
                 '## 这一步具体做什么', '', lesson['try'], '',
                 '需要本章新文件的操作，先按下面代码创建文件，再执行；不要在上一步尚不存在的接口上试错。', '',
                 '## 代码为什么放在这一层', '', lesson['why'], '',
                 '## 在哪里写、写什么', '', '操作地点：终端中的 `$PROJECT`，编辑器打开同一个目录。只创建或替换下列文件，其他文件保留上一步版本。文件目录不存在先创建。']
        # 保留先前补充的具体例子；通用场景已放在最前，不再让补充说明挤掉本步用途。
        scenario = ROOT / 'scenarios' / f'{number}.md'
        if scenario.exists():
            position = lines.index('## 在哪里写、写什么')
            lines[position:position] = [scenario.read_text().rstrip(), '']
        if number == '000':
            lines += ['', '```sh', 'bun --version', 'export COURSE=' + shlex.quote(str(ROOT)), 'export PROJECT="$HOME/ws/harness-own"', 'mkdir -p "$PROJECT"', 'cd "$PROJECT"', '```', '', '固定使用 Bun 1.3.14。目标目录必须为空；不要进入原版仓库或已有 harness-from-zero。以下 package.json 和源码由你创建，不克隆、不展开原版。']
        for path in files:
            relative = path.relative_to(ROOT / 'steps' / number).as_posix()
            text = path.read_text()
            fence = '`' * (max([len(part) for part in __import__('re').findall(r'`{3,}', text)] + [3]) + 1)
            language = {'mjs': 'javascript', 'json': 'json', 'py': 'python', 'html': 'html', 'yml': 'yaml', 'sh': 'sh', 'css': 'css'}.get(path.suffix[1:], 'text')
            if path.parent != ROOT / 'steps' / number:
                parent = str(Path(relative).parent)
                lines += ['', '```sh', 'mkdir -p ' + shlex.quote(parent), '```']
            lines += ['', f'### {"替换" if any(row["path"] == relative for row in manifest) else "创建"} `{relative}`', '', f'{fence}{language}', text.rstrip('\n'), fence]
            manifest.append({'step': number, 'path': relative, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
        command = lesson['run']
        if (ROOT / 'locks' / f'{number}.bun.lock').exists():
            command = command.replace('bun install --ignore-scripts', f'cp "$COURSE/locks/{number}.bun.lock" bun.lock\nbun install --frozen-lockfile --ignore-scripts')
        lines += ['', '## 运行命令与通过标准', '', '```sh', 'cd "$PROJECT"', command, 'bun test', '```', '', lesson['accept'], '',
                  '**本步证据的范围：**' + guide['testEvidence'], '',
                  '## VS Code：断在哪里、看什么', '', lesson['debug'], '',
                  '操作位置：VS Code 打开的是自己的 `$PROJECT`，断点也设在这里的源码，不在教材的 `steps` 目录。', '',
                  '上面的说明若指定CLI、子进程、页面或Electron附加调试，就先按该流程操作；下面这组步骤只用于本章测试入口。“当前测试”不会自动附加子进程，也不会命中浏览器或Electron中的断点。', '',
                  '变量只在所属作用域可见：停在方法内部时看this和参数；要看测试里的局部变量，先在“调用堆栈”选择对应测试帧。正在等待的异步调用者不一定保留可求值的帧，此时在测试调用前后加断点再看，不把未定义误判成业务状态丢失。', '',
                  ('第 000 步先在扩展面板搜索并安装 **Bun**（扩展 ID：`oven.bun-vscode`），再按本章创建 `.vscode/launch.json`。配置首次运行找不到 Bun 时，在 VS Code 集成终端执行 `which bun`，把配置中的 `runtime` 改为该绝对路径。' if number == '000' else '沿用第 000 步安装的 Bun 扩展与 `.vscode/launch.json`；本章列出替换配置时，使用本章完整版本。'), '',
                  ('1. 打开 `src/main.mjs`，在 `const prompt = argv.join(...)` 行左侧单击，出现红点。\n2. 左侧进入“运行和调试”，选择 **Bun：CLI 入口**，按 F5（Mac 功能键被系统占用时按 Fn+F5）。\n3. 停在断点后，在“变量”中展开 `argv`，应看到任务文字；在“调试控制台”输入 `argv.join(" ")` 检查结果。\n4. 按 F10 执行当前行，查看 `prompt`；按 F5 继续，应输出“收到任务：读取 README”。\n5. 再打开 `tests/000-entry.test.mjs`，选择 **Bun：当前测试**，按 F5；调试测试时停在同一个 input 断点。' if number == '000' else '1. 打开本步测试文件 `' + lesson['test'] + '`，保持它为当前编辑器文件。\n2. 在上面指定的函数内单击行号左侧设置断点。\n3. “运行和调试”选择 **Bun：当前测试**，按 F5；它执行当前测试，工作目录固定为 PROJECT。\n4. 在“变量 / 监视 / 调用堆栈 / 调试控制台”检查状态；F10 逐行执行，F11 进入函数，Shift+F11 返回，F5 继续，Shift+F5 停止。'), '',
                  '验收：断点实际命中，能说出当前输入、状态和下一步；只看到进程启动不算完成。长时间暂停会影响真实取消、审批和网络超时，先检查时序，不删超时断言。修正后在集成终端运行 `bun test ./' + lesson['test'] + '`，再运行 `bun test`，保留全部断言。', '',
                  '## 不看答案，确认自己能解释', '', lesson['recall'], '',
                  '完成后在 LEARNING.md 写一句实际结果和一个卡点。明天只重做这个卡点；第 3 天、第 7 天再做一次，能独立完成就继续下一页，不另开学习路线。', '',
                  '**再改一个条件验证：**' + lesson['transfer'], '',
                  '## 与当前原版还差哪些', '',
                  '对照本仓库固定原版 `687f282e8625c6b8d11ff58211a90524be2e4317`；这里的“当前”指该本地基线，不是未经检查的上游最新版。', '',
                  '**这一页已经实现：**', '']
        lines += ['- ' + item for item in guide['implemented']]
        lines += ['', '**原版仍有、或本步尚未对齐的部分：**', '']
        lines += ['- ' + item for item in guide['missing']]
        lines += ['', '**原版对照位置：**', '']
        lines += ['- [' + source + '](../../../deepseek-harness/' + source + ')' for source in guide['sources']]
        lines += ['', '本步测试通过只证明上面的具体行为；完整差距仍看 [COVERAGE.md](../COVERAGE.md)，不以文件数量、同名类或后面出现另一个模块代替接线证据。', '',
                  ('下一步：[第 ' + lessons[int(number)+1]['id'] + ' 步](' + lessons[int(number)+1]['id'] + '.md)' if int(number)+1 < len(lessons) else '这是当前实际实现的最后一步。未取得证据的完整复刻条目仍保持未完成。')]
        lab = ROOT / 'labs' / f'{number}.md'
        if lab.exists():
            lines += ['', lab.read_text()]
        (destination / f'{number}.md').write_text('\n'.join(lines).rstrip('\n') + '\n')
    (ROOT / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    index = ['# 连续步骤索引', '', '从000开始，每次只看下一步。所有步骤都在同一个PROJECT内累计，不切换路线。', '', '每页先看具体场景、文本调用链及紧接着的时序图，再看当前接线位置，按文件写代码；运行和VS Code断点都有具体预期。末尾逐项说明与本地固定原版的差距，不把独立模块或测试当成完整产品能力。', '']
    index += [f'- [{row["id"]} · {row["title"]}](lessons/{row["id"]}.md)（{row["phase"]}）' for row in lessons]
    (ROOT / 'INDEX.md').write_text('\n'.join(index) + '\n')
    print(f'已生成 {len(lessons)} 个连续可运行步骤，{len(manifest)} 次文件增量。')


if __name__ == '__main__':
    main()
