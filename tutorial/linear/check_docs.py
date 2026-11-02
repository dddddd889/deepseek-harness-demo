#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""检查70页教学说明、原版引用与完整代码是否同步；不冒充运行时验收。"""
import hashlib
import json
import re
from pathlib import Path
from debugging import plan_for
from chapter_map import CALLS, render_map, map_files

ROOT = Path(__file__).resolve().parent
ORIGINAL = ROOT.parents[1] / 'deepseek-harness'


def main():
    """逐页核对结构及源码，不修改文件，不连接网络或启动产品。"""
    lessons = json.loads((ROOT / 'lessons.json').read_text())
    manifest = json.loads((ROOT / 'manifest.json').read_text())
    if [row['id'] for row in lessons] != [f'{index:03}' for index in range(70)]:
        raise ValueError('要求覆盖000～069，不得缺页')
    references = set()
    available = set()
    debug_sequences = 0
    chapter_maps = 0
    for lesson in lessons:
        number = lesson['id']
        available.update(path.relative_to(ROOT / 'steps' / number).as_posix() for path in (ROOT / 'steps' / number).rglob('*') if path.is_file())
        # 调试入口必须属于本节且已具备源码；固定测试不能再次退回依赖当前文件。
        plan = plan_for(lesson)
        launch = json.loads((ROOT / 'steps' / number / '.vscode/launch.json').read_text())
        if launch != plan['launch']:
            raise ValueError(number + '本节调试计划与配置不同步')
        names = [row['name'] for row in launch['configurations']]
        if len(names) != len(set(names)) or plan['primary'] not in names:
            raise ValueError(number + '调试配置重名或建议入口不存在')
        for config in launch['configurations']:
            program = config.get('program', '')
            if program == '${file}':
                raise ValueError(number + '本节配置仍依赖当前编辑器文件')
            if program.startswith('${workspaceFolder}/') and program[len('${workspaceFolder}/'):] not in available:
                raise ValueError(number + '调试入口尚未在本节实现：' + program)
        current_test = next(row for row in launch['configurations'] if row['name'] == number + '：本节测试')
        if current_test.get('program') != '${workspaceFolder}/' + lesson['test'] or current_test.get('runtimeArgs', [None])[0] != 'test':
            raise ValueError(number + '固定测试没有指向本节测试文件')
        guide = json.loads((ROOT / 'guides' / (number + '.json')).read_text())
        if guide != lesson['guide']:
            raise ValueError(number + '说明与lessons.json不同步')
        text = (ROOT / 'lessons' / (number + '.md')).read_text()
        if number in CALLS:
            if render_map(lesson).strip() not in text:
                raise ValueError(number + '缺少目录或文件调用图')
            if text.index('## 先看目录与调用关系') > text.index('## 在哪里写、写什么'):
                raise ValueError(number + '目录和调用图必须放在源码之前')
            if any(path not in available for path in map_files(lesson)):
                raise ValueError(number + '目录图出现未来文件')
            chapter_maps += 1
        if '## 本节调试：选什么、为什么、怎么启动' not in text or 'id="lesson-debug-config"' not in text:
            raise ValueError(number + '缺少本节调试入口或配置锚点')
        if any('| ' + row[0] + ' |' not in text for row in plan['rows']):
            raise ValueError(number + '正文调试清单未展示配置')
        if re.search(r'^### (?:创建|替换) \[`.vscode/launch.json`\]', text, re.M):
            raise ValueError(number + '本节调试标题仍误链接到累计工程配置')
        if plan['sequence']:
            if '```mermaid\n' + plan['sequence'] + '\n```' not in text:
                raise ValueError(number + '缺少复杂调试启动时序')
            debug_sequences += 1
        for field in ('scenario', 'flow', 'sequence', 'wiring', 'try', 'why', 'accept', 'debug', 'recall', 'transfer', 'testEvidence'):
            if guide[field] not in text:
                raise ValueError(number + '未展示说明字段：' + field)
        # 保留原文本调用链，并要求时序图紧跟其后、位于接线说明之前。
        flow_block = '```text\n' + guide['flow'] + '\n```'
        sequence_block = '```mermaid\n' + guide['sequence'] + '\n```'
        if guide['sequence'].splitlines()[0].strip() != 'sequenceDiagram':
            raise ValueError(number + '缺少sequenceDiagram时序图')
        flow_position = text.index(flow_block)
        sequence_position = text.index(sequence_block)
        wiring_position = text.index('**当前接线位置：**')
        if not flow_position < sequence_position < wiring_position:
            raise ValueError(number + '文本调用链、时序图和接线说明的顺序不正确')
        for field in ('implemented', 'missing'):
            if any(item not in text for item in guide[field]):
                raise ValueError(number + '未展示对照列表：' + field)
        if '## 先试一件小事' in text or '先试 3～5 分钟' in text:
            raise ValueError(number + '仍有旧的抽象教学模板')
        for folder in ('scenarios', 'labs'):
            supplement = ROOT / folder / (number + '.md')
            if supplement.exists() and supplement.read_text().strip() not in text:
                raise ValueError(number + '丢失已有补充说明：' + folder)
        for source in guide['sources']:
            references.add(source)
            if not (ORIGINAL / source).exists():
                raise ValueError(number + '原版引用不存在：' + source)
            if f'](../../../deepseek-harness/{source})' not in text:
                raise ValueError(number + '缺少原版可点击引用：' + source)
        # 当前测试必须在本步文件增量中存在，调试不能指向未来才创建的测试。
        if not (ROOT / 'steps' / number / lesson['test']).is_file():
            raise ValueError(number + '当前测试不存在')
        # 只检查明确写出的工程文件名，不从自然语言推测函数是否一定会命中。
        debug_paths = re.findall(r'(?:src|tests|web|desktop|scripts)/[A-Za-z0-9_./-]+\.(?:mjs|py|json|html|ts)', guide['debug'])
        for path in debug_paths:
            if path not in available:
                raise ValueError(number + '调试指向当步尚不存在的工程文件：' + path)
    for row in manifest:
        path = ROOT / 'steps' / row['step'] / row['path']
        content = path.read_bytes()
        if hashlib.sha256(content).hexdigest() != row['sha256']:
            raise ValueError('manifest源码hash不匹配：' + str(path))
        source = content.decode().rstrip('\n')
        fence = '`' * (max([len(part) for part in re.findall(r'`{3,}', content.decode())] + [3]) + 1)
        article = (ROOT / 'lessons' / (row['step'] + '.md')).read_text()
        if '\n' + source + '\n' + fence not in article:
            raise ValueError('教程缺少完整代码：' + str(path))
    print(json.dumps({'lessons': len(lessons), 'sequenceDiagrams': len(lessons), 'debugLaunchFiles': len(lessons), 'debugStartupSequences': debug_sequences, 'chapterDirectoryMaps': chapter_maps, 'sourceDeltas': len(manifest), 'originalReferences': len(references), 'allGuideFieldsRendered': True, 'flowThenSequence': True, 'allCodeBlocksMatch': True, 'runtimeTestsExecuted': False}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
