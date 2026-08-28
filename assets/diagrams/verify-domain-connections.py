"""验证领域图保留节点、真实连线和关系表，并检查线段不穿越节点。"""
from pathlib import Path
import re
import xml.etree.ElementTree as ET

# 路径固定在图源目录，检查实际生成产物而非生成器意图。
directory = Path(__file__).resolve().parent
namespace = {'s': 'http://www.w3.org/2000/svg'}
root = ET.parse(directory / 'architecture-domains.svg').getroot()
source = (directory / 'architecture-domains.mmd').read_text()
page = (directory.parent.parent / 'reference/deepseek-harness-build-roadmap.html').read_text()
nodes = {}
for group in root.findall('.//s:g', namespace):
    if group.get('data-node'):
        box = group.find('s:rect', namespace)
        nodes[group.get('data-node')] = tuple(float(box.get(key)) for key in ['x', 'y', 'width', 'height'])
edges = [group for group in root.findall('.//s:g', namespace) if group.get('data-edge')]
assert len(nodes) == 42 and len(edges) == 48
assert len(re.findall(r'^  subgraph ', source, re.M)) == 7
connected = set()
cross_count = 0
for edge in edges:
    identity, start, end = (edge.get(key) for key in ['data-edge', 'data-from', 'data-to'])
    assert start in nodes and end in nodes
    connected.update([start, end])
    cross_count += start.rstrip('0123456789') != end.rstrip('0123456789')
    assert re.search(rf'^  {start} .*\|"{identity} .*"\| {end}$', source, re.M), identity
    assert f'<tr data-edge="{identity}">' in page, identity
    assert edge.find('s:polygon', namespace) is not None, identity
    points = [tuple(map(float, value.split(','))) for value in edge.find('s:polyline', namespace).get('points').split()]
    for (x1, y1), (x2, y2) in zip(points, points[1:]):
        assert x1 == x2 or y1 == y2, identity
        for node, (left, top, width, height) in nodes.items():
            # 接触框边合法，穿越内部则会造成“连到了哪个节点”的歧义。
            hit = (x1 == x2 and left < x1 < left + width and max(min(y1, y2), top) < min(max(y1, y2), top + height)) or (y1 == y2 and top < y1 < top + height and max(min(x1, x2), left) < min(max(x1, x2), left + width))
            assert not hit, (identity, '线段穿越节点', node)
assert connected == set(nodes), '存在完全没有连线的分支'
assert cross_count == 18
assert {edge.get('data-kind') for edge in edges} == {'call', 'event', 'storage', 'telemetry', 'assembly'}
print('通过：七领域、42节点、48条真实连线（18条跨领域），SVG / Mermaid / 页面一致，线段不穿越节点。')
