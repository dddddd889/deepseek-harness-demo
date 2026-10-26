#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把逐页的具体场景、调试观察和原版差距合入课程元数据。"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TEXT_FIELDS = ('scenario', 'flow', 'sequence', 'try', 'why', 'accept', 'debug', 'recall', 'transfer', 'wiring', 'testEvidence')
LIST_FIELDS = ('implemented', 'missing', 'sources')


def enrich_lessons(lessons):
    """要求每一页都有具体说明；缺页或空字段时停止生成，不用套话补位。"""
    expected = {lesson['id'] for lesson in lessons}
    found = {path.stem for path in (ROOT / 'guides').glob('*.json')}
    if found != expected:
        raise ValueError('逐页说明不齐：缺少' + str(sorted(expected - found)) + '，多出' + str(sorted(found - expected)))
    for lesson in lessons:
        guide = json.loads((ROOT / 'guides' / (lesson['id'] + '.json')).read_text())
        for field in TEXT_FIELDS:
            if not isinstance(guide.get(field), str) or not guide[field].strip():
                raise ValueError(lesson['id'] + ' 缺少具体说明：' + field)
        if guide['sequence'].splitlines()[0].strip() != 'sequenceDiagram':
            raise ValueError(lesson['id'] + ' 时序图必须使用sequenceDiagram')
        for field in LIST_FIELDS:
            if not isinstance(guide.get(field), list) or not guide[field] or any(not isinstance(value, str) or not value.strip() for value in guide[field]):
                raise ValueError(lesson['id'] + ' 缺少非空列表：' + field)
        for source in guide['sources']:
            if Path(source).is_absolute() or '..' in Path(source).parts:
                raise ValueError('原版引用必须相对于deepseek-harness目录：' + source)
        # 旧syllabus的流程顺序和运行命令保留；教学表述统一以逐页核对的guide为准。
        for field in ('try', 'why', 'accept', 'debug', 'recall', 'transfer'):
            lesson[field] = guide[field]
        lesson['original'] = '；'.join(guide['missing'])
        lesson['guide'] = guide
