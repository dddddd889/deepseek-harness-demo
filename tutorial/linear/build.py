#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把独立实现的逐步增量编成教程；不读取或拆分原版源码。"""
import hashlib
import json
import shlex
from pathlib import Path
from harness_links import link_harness_files
from debugging import write_launch_files, render_debugging
from chapter_map import render_map

ROOT = Path(__file__).resolve().parent


def main():
    """每步只展示本步文件，保留唯一前置、可执行命令和学习闭环。"""
    lessons = json.loads((ROOT / 'lessons.json').read_text())
    # 调试配置也属于当步可复制增量，先按本节计划生成，再收集正文与内容摘要。
    write_launch_files(lessons)
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
        # 复杂章节先给目录和调用图，再读动手步骤、补充场景与逐文件源码。
        overview = render_map(lesson)
        if overview:
            position = lines.index('## 这一步具体做什么')
            lines[position:position] = [overview, '']
        # 保留先前补充的具体例子；通用场景已放在最前，不再让补充说明挤掉本步用途。
        scenario = ROOT / 'scenarios' / f'{number}.md'
        if scenario.exists():
            position = lines.index('## 在哪里写、写什么')
            lines[position:position] = [scenario.read_text().rstrip(), '']
        # 调试目标先于配置代码说明，读者无需从累计工程配置猜本节该选哪一项。
        position = lines.index('## 在哪里写、写什么')
        lines[position:position] = [render_debugging(lesson), '']
        if number == '000':
            # 已迁入的harness-own保留现有进度，000的创建操作必须使用学习者显式选定的新空目录。
            lines += ['', '本仓库的 `harness-own/` 是保留当前进度的现有练习工程，不能清空，也不能把下面第000步的文件覆盖进去。先在仓库目录按 [README](../README.md) 初始化环境：', '',
                      '```sh', 'bun --version', 'export REPO="$(git rev-parse --show-toplevel)"', 'export COURSE="$REPO/tutorial/linear"', 'export PROJECT="$REPO/harness-own"', '```', '',
                      '继续已有进度时使用上面的PROJECT和当前课次。若要从第000步独立重做，请先显式选择一个新的同仓目录，例如下面的 `harness-practice-000`；确认该目录名尚未使用后，自行创建空目录，再执行进入目录的命令。这里不会自动创建、清空或覆盖目录：', '',
                      '```sh', 'export PROJECT="$REPO/harness-practice-000"', 'cd "$PROJECT"', '```', '',
                      '固定使用 Bun 1.3.14。第000步的目标目录必须为空；不要使用已有进度的harness-own、原版仓库或已有harness-from-zero。以下package.json和源码由你在新空目录创建，不克隆、不展开原版。后续新终端继续使用你选定的PROJECT。']
        for path in files:
            relative = path.relative_to(ROOT / 'steps' / number).as_posix()
            text = path.read_text()
            fence = '`' * (max([len(part) for part in __import__('re').findall(r'`{3,}', text)] + [3]) + 1)
            language = {'mjs': 'javascript', 'json': 'json', 'py': 'python', 'html': 'html', 'yml': 'yaml', 'sh': 'sh', 'css': 'css'}.get(path.suffix[1:], 'text')
            if path.parent != ROOT / 'steps' / number:
                parent = str(Path(relative).parent)
                lines += ['', '```sh', 'mkdir -p ' + shlex.quote(parent), '```']
            if relative == '.vscode/launch.json':
                lines += ['', '<a id="lesson-debug-config"></a>', '',
                          '下面是本节专用调试配置，只包含本节入口。program 已固定到本节文件；不是 harness-own 的累计配置。']
            lines += ['', f'### {"替换" if any(row["path"] == relative for row in manifest) else "创建"} `{relative}`', '', f'{fence}{language}', text.rstrip('\n'), fence]
            manifest.append({'step': number, 'path': relative, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
        command = lesson['run']
        if (ROOT / 'locks' / f'{number}.bun.lock').exists():
            command = command.replace('bun install --ignore-scripts', f'cp "$COURSE/locks/{number}.bun.lock" bun.lock\nbun install --frozen-lockfile --ignore-scripts')
        lines += ['', '## 运行命令与通过标准', '', '```sh', 'cd "$PROJECT"', command, 'bun test', '```', '', lesson['accept'], '',
                  '**本步证据的范围：**' + guide['testEvidence'], '',
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
        # 同仓源码链接按已提交文件生成；围栏内代码仍保持该课完整原文。
        markdown = link_harness_files('\n'.join(lines).rstrip('\n') + '\n', number)
        (destination / f'{number}.md').write_text(markdown)
    (ROOT / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    index = ['# 连续步骤索引', '', '从000开始，每次只看下一步。所有步骤都在同一个PROJECT内累计，不切换路线。', '', '每页先看具体场景、文本调用链及紧接着的时序图，再看当前接线位置，按文件写代码；运行和VS Code断点都有具体预期。末尾逐项说明与本地固定原版的差距，不把独立模块或测试当成完整产品能力。', '']
    index += [f'- [{row["id"]} · {row["title"]}](lessons/{row["id"]}.md)（{row["phase"]}）' for row in lessons]
    (ROOT / 'INDEX.md').write_text('\n'.join(index) + '\n')
    print(f'已生成 {len(lessons)} 个连续可运行步骤，{len(manifest)} 次文件增量。')


if __name__ == '__main__':
    main()
