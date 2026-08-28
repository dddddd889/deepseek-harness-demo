"""校验全部课程图像及其页面引用，不执行网页脚本。"""
from pathlib import Path
from html.parser import HTMLParser
import re
import xml.etree.ElementTree as ET

# 所有路径从脚本位置计算，与调用工作目录无关。
directory = Path(__file__).resolve().parent
root = directory.parent.parent
namespace = {'svg': 'http://www.w3.org/2000/svg'}

class Page(HTMLParser):
    """收集页面中的图片和链接以检查离线引用。"""
    def __init__(self):
        super().__init__()
        self.images = []
        self.links = []

    def handle_starttag(self, tag, attrs):
        fields = dict(attrs)
        if tag == 'img' and 'diagrams/' in fields.get('src', ''):
            assert fields.get('alt'), '图像缺少替代文本'
            self.images.append(fields['src'])
        if tag == 'a' and 'diagrams/' in fields.get('href', ''):
            self.links.append(fields['href'])

# 两张总图及每课四类图像，共 70 份，必须与图源一一配对。
svgs = sorted(directory.glob('*.svg'))
assert len(svgs) == 70, f'图像数量异常：{len(svgs)}'
assert len(list(directory.glob('*.mmd'))) == 70
for path in svgs:
    xml = ET.parse(path).getroot()
    width, height = float(xml.attrib['width']), float(xml.attrib['height'])
    assert xml.find('svg:title', namespace) is not None
    assert len(xml.findall('.//svg:rect', namespace)) >= 4
    # 箭头允许使用显式多边形，或复用带路径图形的 SVG marker。
    arrows = len(xml.findall('.//svg:polygon', namespace))
    marker_paths = [node for node in xml.findall('.//svg:path', namespace) if node.get('marker-end') or node.get('marker-start')]
    for group in xml.findall('.//svg:g', namespace):
        if group.get('marker-end') or group.get('marker-start'):
            marker_paths.extend(group.findall('svg:path', namespace))
    assert arrows >= 4 or (xml.find('.//svg:marker/svg:path', namespace) is not None and len(marker_paths) >= 4)
    assert 'NaN' not in path.read_text() and 'Infinity' not in path.read_text()
    for element in xml.iter():
        if element.tag.endswith(('polyline', 'polygon')):
            for point in element.attrib['points'].split():
                x, y = map(float, point.split(','))
                assert 0 <= x <= width and 0 <= y <= height, (path, point)
        if element.tag.endswith('rect'):
            x, y = float(element.get('x', 0)), float(element.get('y', 0))
            assert 0 <= x and 0 <= y
            assert x + float(element.get('width', 0)) <= width
            assert y + float(element.get('height', 0)) <= height
    source = path.with_suffix('.mmd').read_text()
    assert 'flowchart TD' in source or 'sequenceDiagram' in source
    # Mermaid 引号标签必须出现在对应 SVG 中，避免导出图源与图像漂移。
    visible = ''.join(xml.itertext())
    for label in re.findall(r'"([^"\n]+)"', source):
        assert label in visible, (path.name, label)
    if path.stem.endswith('-position'):
        highlighted = [node for node in xml.findall('.//svg:rect', namespace) if node.get('fill') == '#fff0c2']
        assert len(highlighted) == 1, (path, '本课应只有一个高亮职责')
        box = highlighted[0]
        left, top = float(box.get('x')), float(box.get('y'))
        highlighted_text = ''.join(
            ''.join(node.itertext()) for node in xml.findall('.//svg:text', namespace)
            if left < float(node.get('x')) < left + 260 and top < float(node.get('y')) < top + 78
        )
        assert highlighted_text.startswith(f'第 {int(path.name[:4])} 课：'), (path, highlighted_text)

# 每课必须引用四类图，并具有独立定位说明和三套框架的证据。
pages = sorted((root / 'lessons').glob('*.html'))
assert len(pages) == 17
for page in pages:
    parsed = Page(); parsed.feed(page.read_text())
    course_id = page.name.split('-')[0]
    expected = {f'../assets/diagrams/{course_id}-{kind}.svg' for kind in ['position', 'modules', 'sequence', 'branches']}
    assert len(parsed.images) == 4 and set(parsed.images) == expected, page
    content = page.read_text()
    assert 'deepseek-harness-build-roadmap.html#architecture-domains' in content
    assert content.count('id="system-position"') == 1
    assert content.count('id="framework-comparison"') == 1
    position = content.split('id="system-position"', 1)[1].split('</section>', 1)[0]
    for label in ['上游与输入', '下游与输出', '不归本章负责', '放进具体场景']:
        assert label in position, (page, label)
    comparison = content.split('id="framework-comparison"', 1)[1].split('</section>', 1)[0]
    assert content.index('id="framework-comparison"') < content.index('id="system-position"'), page
    assert 'href="#concept-index"' in content
    assert '<details><summary>章节概览（可选）' in content
    for dimension in ['mechanism', 'boundary', 'sources']:
        assert comparison.count(f'data-dimension="{dimension}"') == 1
    for framework in ['deepseek', 'deepagents', 'openhands']:
        cells = re.findall(rf'<td data-framework="{framework}">(.*?)</td>', comparison, re.S)
        assert len(cells) == 3 and all(cells), (page, framework)
        sources = re.findall(r'href="([^"]+)"', cells[2])
        assert sources, (page, framework, '缺少依据')
        for source in sources:
            if source.startswith('../'):
                assert (page.parent / source).resolve().exists(), (page, source)
            else:
                assert source.startswith(('https://docs.langchain.com/', 'https://docs.openhands.dev/')), source
    # 每幅定位图只高亮自身章节；不能把同一高亮复制到所有课程。
    position_source = (directory / f'{course_id}-position.mmd').read_text()
    assert f'class c{int(course_id)} current' in position_source
    assert len(re.findall(r'^  c\d+\[', position_source, re.M)) == 17
    assert 'deepseek-harness-build-roadmap.html#site-architecture' in page.read_text()
    for image in expected:
        assert image.replace('.svg', '.mmd') in parsed.links
    for url in parsed.images + parsed.links:
        assert (page.parent / url).resolve().exists(), (page, url)
roadmap = root / 'reference/deepseek-harness-build-roadmap.html'
parsed = Page(); parsed.feed(roadmap.read_text())
assert parsed.images == ['../assets/diagrams/architecture-domains.svg', '../assets/diagrams/site-architecture.svg']
assert 'id="architecture-domains"' in roadmap.read_text()
# 领域细化必须同时出现在 HTML、SVG 和 Mermaid，而不是只增加几个标题。
domain_sections = re.findall(r'<article id="domain-([^"]+)" class="domain-detail">(.*?)</article>', roadmap.read_text(), re.S)
assert [key for key, _ in domain_sections] == ['frontend', 'server', 'core', 'execution', 'storage', 'observability', 'foundation']
domain_svg = ''.join(ET.parse(directory / 'architecture-domains.svg').getroot().itertext())
domain_source = (directory / 'architecture-domains.mmd').read_text()
for key, section in domain_sections:
    branches = re.findall(r'<th scope="row">(.*?)</th>', section)
    assert len(branches) == 6, (key, '每个领域应有六个阅读分支')
    assert '内部关系：' in section
    assert f'subgraph {key}[' in domain_source
    for branch in branches:
        assert branch in domain_svg and f'["{branch}"]' in domain_source, (key, branch)
    assert len(re.findall(r'href="../deepseek-harness/', section)) == 6
    assert f'href="#domain-{key}"' in roadmap.read_text()
for target in re.findall(r'href="(\.\./[^"#]+)(?:#[^"]*)?"', roadmap.read_text()):
    assert (roadmap.parent / target).resolve().exists(), target
assert 'id="site-architecture"' in roadmap.read_text()
# 首页总表必须覆盖 17 个主题，每行三框架机制，且深链接能落到对应课的对比区。
overview = roadmap.read_text().split('id="framework-overview"', 1)[1].split('</section>', 1)[0]
overview_rows = re.findall(r'<tr data-chapter="(\d{4})">(.*?)</tr>', overview, re.S)
assert [row[0] for row in overview_rows] == [f'{number:04}' for number in range(1, 18)]
for chapter, row in overview_rows:
    assert len(re.findall(r'<td>', row)) == 3
    target = re.search(r'href="([^\"]+#framework-comparison)"', row).group(1)
    target_file = (roadmap.parent / target.split('#')[0]).resolve()
    assert target_file.name.startswith(chapter + '-') and 'id="framework-comparison"' in target_file.read_text()
print('通过：70 对图源、领域总图与17课入口、前置三列对比、定位说明、本地依据，以及首页17行三框架总表与深链接。')
