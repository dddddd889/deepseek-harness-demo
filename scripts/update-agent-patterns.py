"""把模式伪代码嵌入已有沙盒页面，保留外层文档、iframe 属性与 CSP。"""

from pathlib import Path
import ast
import html
import json
import re


# 仓库路径和两份输入文件；脚本不执行页面或伪代码中的任何代码。
ROOT = Path(__file__).resolve().parent.parent
PAGE = ROOT / "sites/agent-patterns/dist/index.html"
DATA = ROOT / "sites/agent-patterns/pseudocode.json"


def code_block(entry):
    """把一份带中文注释的伪代码转为纯文本代码块。"""
    code = "\n".join(entry["code"])  # 组装代码，供格式验证与安全转义使用。
    ast.parse(code)  # 仅检查 Python 风格语法，不执行抽象函数。
    return '<pre class="ap-code"><code>' + html.escape(code) + "</code></pre>"


def static_example(entry):
    """生成 ReAct 与 Goal 的折叠参考，不增加模式选择器的选项。"""
    title = html.escape(entry["name"])  # 展示名称保持为文本。
    source = html.escape(entry["source"], quote=True)  # 来源链接转义为属性值。
    return (
        '<details class="ap-extra"><summary>' + title + "：执行伪代码</summary>"
        + "<p>" + html.escape(entry["core"]) + "</p>"
        + code_block(entry)
        + '<p class="text-small">参考：<a target="_blank" rel="noreferrer" href="'
        + source + '">' + html.escape(entry["implementation"]) + "</a></p>"
        + "</details>"
    )


def main():
    """只更新 iframe 中的伪代码区和渲染逻辑，支持重复生成。"""
    data = json.loads(DATA.read_text())  # 读取经过审阅的模式数据。
    expected = {"plan", "rewoo", "compiler", "reflexion", "lats", "codeact",
                "evaluator", "workers", "memory", "harness"}  # 原图的十个模式键。
    if set(data["patterns"]) != expected:
        raise ValueError("伪代码必须覆盖原图的十个模式。")
    for entry in data["patterns"].values():
        ast.parse("\n".join(entry["code"]))  # 保证缩进和结构可读，不检查抽象 API。

    outer = PAGE.read_text()  # 保留外层完整文档。
    attribute = re.search(r'data-srcdoc="([^"]*)"', outer)  # 只定位已转义的 iframe 文档。
    if attribute is None:
        raise ValueError("没有找到原页面的沙盒文档。")
    inner = html.unescape(attribute.group(1))  # 只解码为文本，不加载外部资源。

    # 删除此前生成的区块，防止重复运行出现多份伪代码。
    inner = re.sub(r"\n*<!-- AP-CODE-STYLE:START -->.*?<!-- AP-CODE-STYLE:END -->\n*",
                   "\n", inner, flags=re.S)
    inner = re.sub(r"\n*<!-- AP-CODE-PANELS:START -->.*?<!-- AP-CODE-PANELS:END -->\n*",
                   "\n", inner, flags=re.S)
    inner = re.sub(r"\n*  // AP-CODE-DATA:START.*?  // AP-CODE-DATA:END\n*",
                   "\n", inner, flags=re.S)
    inner = re.sub(r"\n*    // AP-CODE-RENDER:START.*?    // AP-CODE-RENDER:END\n*",
                   "\n", inner, flags=re.S)

    # 代码块允许换行，窄屏无需横向滚动。
    style = """
<!-- AP-CODE-STYLE:START -->
<style>
  #agent-patterns-explainer .ap-code { white-space: pre-wrap; overflow-wrap: anywhere; }
  #agent-patterns-explainer .ap-implementation { margin-top: 20px; }
  #agent-patterns-explainer .ap-extra { margin-top: 16px; }
</style>
<!-- AP-CODE-STYLE:END -->
"""
    inner = inner.replace('<div id="agent-patterns-explainer">',
                          '<div id="agent-patterns-explainer">' + style, 1)

    # 静态补充区和随模式变化的代码区均放在图形后面。
    panels = """
<!-- AP-CODE-PANELS:START -->
  <section class="ap-implementation" aria-label="所选模式的执行伪代码">
    <h3 data-code-title>执行伪代码</h3>
    <p class="text-small">根据代表实现提炼的 Python 风格伪代码；函数名表示抽象职责，不是可直接调用的 SDK API。</p>
    <p data-code-core></p>
    <pre class="ap-code"><code data-code></code></pre>
    <p data-code-example></p>
    <p class="text-small">参考实现：<a data-code-source target="_blank" rel="noreferrer"></a></p>
    <p class="text-small" data-code-url></p>
  </section>
""" + static_example(data["baseline"]) + static_example(data["goal"]) + """
<!-- AP-CODE-PANELS:END -->
"""
    anchor = "</div>\n<script>\n(() => {\n  // 当前可视化"
    if anchor not in inner:
        raise ValueError("原可视化的根节点结构已改变。")
    inner = inner.replace(anchor, panels + "\n" + anchor, 1)

    # JSON 数据只能进入 textContent，不允许伪代码变为可执行脚本。
    serialized = json.dumps(data["patterns"], ensure_ascii=False).replace("<", "\\u003c")
    definitions = "\n  // AP-CODE-DATA:START\n  // 每个模式的代码、中文解释和参考实现。\n  const implementations = " + serialized + ";\n  // AP-CODE-DATA:END\n"
    marker = "  // 创建 SVG 元素"
    if marker not in inner:
        raise ValueError("未找到原可视化的数据定义插入点。")
    inner = inner.replace(marker, definitions + marker, 1)

    # 和原图共用同一个选择器，切换模式时同步说明、代码与来源。
    render_code = """
    // AP-CODE-RENDER:START
    // 当前模式的伪代码仅作为文本展示，不在浏览器运行。
    const implementation = implementations[choice.value];
    root.querySelector('[data-code-title]').textContent = selected.name + ' · 执行伪代码';
    root.querySelector('[data-code-core]').textContent = '关键机制：' + implementation.core;
    root.querySelector('[data-code]').textContent = implementation.code.join('\\n');
    root.querySelector('[data-code-example]').textContent = '举例：' + implementation.example;
    root.querySelector('[data-code-source]').href = implementation.source;
    root.querySelector('[data-code-source]').textContent = implementation.implementation;
    root.querySelector('[data-code-url]').textContent = implementation.source;
    // AP-CODE-RENDER:END
"""
    render_anchor = "    detailSvg.setAttribute('aria-label',selected.name+'：'+selected.summary);"
    if render_anchor not in inner:
        raise ValueError("原可视化的渲染函数已改变。")
    inner = inner.replace(render_anchor, render_code + render_anchor, 1)

    # 替换范围限制在属性值内部，sandbox 与外层 CSP 保持原样。
    result = outer[:attribute.start(1)] + html.escape(inner, quote=True) + outer[attribute.end(1):]
    PAGE.write_text(result)
    print("已嵌入十种模式伪代码，以及 ReAct / Goal 对照。")


if __name__ == "__main__":
    main()
