#!/usr/bin/env python3
"""只验范围与诚实边界，文件齐全永远不自动变成原版等价。"""
import argparse
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent


def main():
    """未实现项阻止完整交付声明；不会把缺失行从分母移走。"""
    parser = argparse.ArgumentParser()
    parser.add_argument('--require-complete', action='store_true')
    args = parser.parse_args()
    data = json.loads((ROOT / 'coverage.json').read_text())
    lessons = json.loads((ROOT / 'lessons.json').read_text())
    expected = {f'G{index:02}' for index in range(1, 35)}
    if {row['id'] for row in data['requirements']} != expected:
        raise ValueError('原版34项要求缺失或重复')
    if len(data['groups']) != 52 or sum(row['count'] for row in data['groups']) != 342:
        raise ValueError('原版包组范围发生无证据缩减')
    if any(not row['requirements'] for row in data['groups']):
        raise ValueError('存在没有责任归属的包组')
    if [row['id'] for row in lessons] != [f'{index:03}' for index in range(len(lessons))]:
        raise ValueError('步骤不是连续单线')
    # 原版只允许出现在oracle测试进程，不能成为自己产品实现的后门。
    for path in (ROOT / 'steps').rglob('*'):
        if not path.is_file() or not {'src', 'desktop', 'web'}.intersection(path.parts):
            continue
        if re.search(r'(?:from\s+|import\s*\()[\'\"](?:@deepseek-ai/dsh-|[^\'\"]*deepseek-harness/packages)', path.read_text()):
            raise ValueError('产品代码导入了原版实现：' + str(path))
    pending = [row['id'] for row in data['requirements'] if row['parity'] != 'complete']
    print(json.dumps({'scopeIntact': True, 'linearSteps': len(lessons), 'originalParityComplete': not pending, 'unclosedRequirements': pending}, ensure_ascii=False, indent=2))
    if args.require_complete and pending:
        raise SystemExit('完整复刻尚未完成，不能发布完成声明。')


if __name__ == '__main__':
    main()
