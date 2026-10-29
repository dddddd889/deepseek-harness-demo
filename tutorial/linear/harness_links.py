"""为课文的文件标题生成同仓练习链接，不改动任何围栏代码或教学片段。"""

import json
from pathlib import Path, PurePosixPath
import re
import subprocess
from urllib.parse import quote


# 自有区块使用明确标记，重复生成时仅替换这一区块，保留其他正文原样。
SECTION_START = "<!-- harness-own-links:start -->"
SECTION_END = "<!-- harness-own-links:end -->"
INSERT_BEFORE = "## 什么时候会用到这一页"
HEADER = re.compile(
    r"^(?P<prefix> {0,3}###[ \t]+(?:创建|替换)[ \t]+)"
    r"(?:`(?P<plain>[^`\n]+)`|\[`(?P<linked>[^`\n]+)`\]\([^\n)]*\))"
    r"(?P<suffix>[ \t]*)$"
)
FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})(.*)$")


def _next_fence(line, current):
    """识别反引号或波浪线围栏，较短的内嵌围栏不能提前结束代码块。"""
    match = FENCE.match(line.rstrip("\r\n"))
    if current:
        if (
            match
            and match.group(1)[0] == current[0]
            and len(match.group(1)) >= current[1]
            and not match.group(2).strip()
        ):
            return None
        return current
    if match:
        return match.group(1)[0], len(match.group(1))
    return None


def _without_generated_section(markdown):
    """只移除代码围栏之外的自有链接区块，避免重复叠加或误删示例代码。"""
    lines = markdown.splitlines(keepends=True)
    kept = []
    fence = None
    index = 0
    while index < len(lines):
        line = lines[index]
        if fence or FENCE.match(line.rstrip("\r\n")):
            fence = _next_fence(line, fence)
            kept.append(line)
            index += 1
            continue
        if line.rstrip("\r\n") == SECTION_START:
            end = index + 1
            while end < len(lines) and lines[end].rstrip("\r\n") != SECTION_END:
                end += 1
            if end == len(lines):
                raise ValueError("练习文件链接区块缺少结束标记，停止以免改坏正文")
            index = end + 1
            # 生成时只在结束标记后增加一个空行；移除同一空行可保持重复执行稳定。
            if index < len(lines) and lines[index].rstrip("\r\n") == "":
                index += 1
            continue
        kept.append(line)
        index += 1
    return "".join(kept)


def _safe_path(value):
    """文件映射只能指向练习目录内的相对文件，不接受越界或绝对路径。"""
    if not isinstance(value, str) or not value or "\\" in value:
        raise ValueError("练习文件映射必须是非空的正斜杠相对路径")
    path = PurePosixPath(value)
    if path.is_absolute() or not path.parts or ".." in path.parts or str(path) != value:
        raise ValueError("练习文件映射不能越出 harness-own：" + value)
    return value


def _aliases():
    """读取与网站共享的五组已核对改名映射，不按名称相似程度推测文件关系。"""
    metadata = json.loads(Path(__file__).with_name("harness-links.json").read_text())
    aliases = metadata.get("aliases")
    if metadata.get("schemaVersion") != 1 or not isinstance(aliases, dict):
        raise ValueError("harness-links.json 必须使用 schemaVersion 1 和 aliases 对象")
    for lesson_id, entries in aliases.items():
        if not re.fullmatch(r"\d{3}", lesson_id) or not isinstance(entries, dict):
            raise ValueError("练习文件映射课次或内容格式错误")
        for original, target in entries.items():
            _safe_path(original)
            _safe_path(target)
    return aliases


def _committed_harness_files(repository_root):
    """以 HEAD 的普通 blob 为唯一白名单，忽略工作区和暂存区新增的未发布文件。"""
    result = subprocess.run(
        ["git", "ls-tree", "-r", "-z", "HEAD", "--", "harness-own"],
        cwd=repository_root,
        check=True,
        capture_output=True,
    )
    files = set()
    for entry in result.stdout.decode("utf-8").split("\0"):
        if not entry:
            continue
        details, path = entry.split("\t", 1)
        mode, kind, _ = details.split(" ", 2)
        if mode in ("100644", "100755") and kind == "blob" and path.startswith("harness-own/"):
            files.add(path[len("harness-own/"):])
    return files


def _harness_href(path):
    """课文位于 tutorial/linear/lessons，统一生成回到仓库根的相对源码链接。"""
    return "../../../harness-own/" + quote(path, safe="/._-")


def link_harness_files(markdown, lesson_id, repository_root=None):
    """链接创建或替换标题并增加文件状态表，原始围栏代码和教学片段保持不变。"""
    if not re.fullmatch(r"\d{3}", lesson_id):
        raise ValueError("课次必须是三位数字")
    repository_root = Path(repository_root) if repository_root else Path(__file__).resolve().parents[2]
    committed = _committed_harness_files(repository_root)
    aliases = _aliases().get(lesson_id, {})
    source = _without_generated_section(markdown)
    newline = "\r\n" if "\r\n" in source else "\n"
    lines = source.splitlines(keepends=True)
    linked = []
    paths = []
    fence = None
    insertion_index = None
    for line in lines:
        if fence or FENCE.match(line.rstrip("\r\n")):
            fence = _next_fence(line, fence)
            linked.append(line)
            continue
        content = line.rstrip("\r\n")
        if content == INSERT_BEFORE and insertion_index is None:
            insertion_index = len(linked)
        match = HEADER.match(content)
        if not match:
            linked.append(line)
            continue
        path = _safe_path(match.group("plain") or match.group("linked"))
        if path not in paths:
            paths.append(path)
        target = aliases.get(path, path)
        label = "`" + path + "`"
        if target in committed:
            label = "[" + label + "](" + _harness_href(target) + ")"
        linked.append(match.group("prefix") + label + match.group("suffix") + line[len(content):])

    # 当前工程是逐步累积的版本；缺少的文件只显示状态，不制造一个必然失效的链接。
    section = [
        SECTION_START,
        "## 当前练习工程文件",
        "",
        "以下链接指向 `harness-own` 的当前累计版本；本课下方的完整代码仍保留当步版本，二者可能不同。",
        "",
        (
            "[打开练习工程说明](" + _harness_href("README.md") + ")"
            if "README.md" in committed else "练习工程说明尚未合入 harness-own。"
        ),
        "",
        "| 本课文件 | 当前练习工程文件 |",
        "| --- | --- |",
    ]
    for path in paths:
        target = aliases.get(path, path)
        destination = (
            "[`harness-own/" + target + "`](" + _harness_href(target) + ")"
            if target in committed else "尚未合入 harness-own"
        )
        section.append("| `" + path + "` | " + destination + " |")
    if not paths:
        section.append("| — | 本课未单独列出创建或替换文件 |")
    section.extend(["", SECTION_END, "", ""])
    # 正文预设插入点必须存在；明确报错，避免在错误课文位置追加一份无法核对的表格。
    if insertion_index is None:
        raise ValueError("课文缺少练习链接插入位置：" + INSERT_BEFORE)
    linked.insert(insertion_index, newline.join(section))
    return "".join(linked)
