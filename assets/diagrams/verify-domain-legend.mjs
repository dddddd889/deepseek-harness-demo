import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';

// 使用实际发布 SVG 中的脚本，验证点击、多选、键盘和取消选择。
const svg = await readFile(new URL('./architecture-domains.svg', import.meta.url), 'utf8');
const script = svg.match(/<script><!\[CDATA\[([\s\S]*?)\]\]><\/script>/)?.[1];
assert.ok(script, 'SVG 应包含图例交互脚本');
// 最小 DOM 替身只模拟交互脚本使用的属性、样式类和事件接口。
function element(attributes) {
  const classes = new Set(), listeners = {};
  return { attributes, classes, listeners,
    getAttribute: key => attributes[key],
    setAttribute: (key, value) => { attributes[key] = value; },
    addEventListener: (key, callback) => { listeners[key] = callback; },
    classList: { toggle: (key, active) => active ? classes.add(key) : classes.delete(key) },
  };
}
const legends = [...svg.matchAll(/data-legend="([^"]+)" role=/g)].map(([, kind]) => element({ 'data-legend': kind }));
const edges = [...svg.matchAll(/data-edge="([^"]+)" data-from="[^"]+" data-to="[^"]+" data-kind="([^"]+)"/g)].map(([, id, kind]) => element({ 'data-edge': id, 'data-kind': kind }));
const labels = edges.map(edge => element({ 'data-edge-label': edge.getAttribute('data-edge') }));
const listeners = {};
const document = {
  querySelectorAll: selector => ({ '[data-legend]': legends, '[data-edge]': edges, '[data-edge-label]': labels })[selector],
  addEventListener: (key, callback) => { listeners[key] = callback; },
};
runInNewContext(script, { document });
assert.equal(legends.length, 5);
assert.equal(edges.length, 48);
// 每种类别逐一选中和取消，检查所有入选线及对应标签。
for (const button of legends) {
  button.listeners.click();
  assert.equal(button.getAttribute('aria-pressed'), 'true');
  edges.forEach((edge, index) => {
    const expected = edge.getAttribute('data-kind') === button.getAttribute('data-legend');
    assert.equal(edge.classes.has('kind-selected'), expected);
    assert.equal(labels[index].classes.has('kind-selected'), expected);
  });
  button.listeners.click();
  assert.ok(edges.every(edge => !edge.classes.has('kind-selected')));
}
let prevented = 0;
legends[0].listeners.keydown({ key: 'Enter', preventDefault: () => prevented++ });
legends[1].listeners.keydown({ key: ' ', preventDefault: () => prevented++ });
assert.equal(prevented, 2);
assert.equal(legends.filter(button => button.getAttribute('aria-pressed') === 'true').length, 2);
listeners.keydown({ key: 'Escape' });
assert.ok(edges.every(edge => !edge.classes.has('kind-selected')));
assert.ok(legends.every(button => button.getAttribute('aria-pressed') === 'false'));
console.log('通过：五类图例、48条连线及标签、选择与取消、多选、键盘切换和清空。');
