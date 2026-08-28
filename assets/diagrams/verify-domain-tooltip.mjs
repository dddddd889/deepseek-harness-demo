import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';

// 使用生成产物里的浮层脚本检查每一条关系，而不是另写一份交互实现。
const svg = await readFile(new URL('./architecture-domains.svg', import.meta.url), 'utf8');
const scripts = [...svg.matchAll(/<script><!\[CDATA\[([\s\S]*?)\]\]><\/script>/g)];
assert.equal(scripts.length, 2);
// DOM 替身记录属性和事件，并模拟页面中缩小到一半的 SVG。
function element(attributes = {}) {
  return { attributes, listeners: {}, textContent: '',
    setAttribute(key, value) { this.attributes[key] = String(value); },
    getAttribute(key) { return this.attributes[key]; },
    addEventListener(key, callback) { this.listeners[key] = callback; },
    getBoundingClientRect() { return { left: 100, top: 100, bottom: 125, width: 120 }; },
    querySelector() { return { remove() {} }; },
  };
}
const labels = [...svg.matchAll(/<g data-edge-label="[^"]+"[^>]*>/g)].map(([tag]) => element(Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value]))));
const edges = new Map(labels.map(label => [label.getAttribute('data-edge-label'), element()]));
const ids = new Map(['edge-tooltip', 'edge-tooltip-box', 'edge-tooltip-title', 'edge-tooltip-start', 'edge-tooltip-end'].map(id => [id, element()]));
const listeners = {};
const root = {
  getScreenCTM: () => ({ a: 0.5, b: 0, inverse: () => ({}) }),
  getBoundingClientRect: () => ({ left: 0, top: 0, right: 800, bottom: 2310, width: 800 }),
  createSVGPoint: () => ({ x: 0, y: 0, matrixTransform() { return { x: this.x * 2, y: this.y * 2 }; } }),
};
const document = { documentElement: root,
  getElementById: id => ids.get(id),
  querySelectorAll: () => labels,
  querySelector: selector => edges.get(selector.match(/"([^"]+)"/)[1]),
  addEventListener: (key, callback) => { listeners[key] = callback; },
};
runInNewContext(scripts[1][1], { document });
const tip = ids.get('edge-tooltip');
assert.equal(labels.length, 48);
for (const label of labels) {
  for (const target of [label, edges.get(label.getAttribute('data-edge-label'))]) {
    target.listeners.pointerenter({ clientX: 200, clientY: 300 });
    assert.equal(tip.getAttribute('visibility'), 'visible');
    assert.equal(ids.get('edge-tooltip-start').textContent, '起点：' + label.getAttribute('data-start-name'));
    assert.equal(ids.get('edge-tooltip-end').textContent, '→ 终点：' + label.getAttribute('data-end-name'));
    assert.match(tip.getAttribute('transform'), /scale\(2\)/);
    const first = tip.getAttribute('transform');
    target.listeners.pointermove({ clientX: 250, clientY: 350 });
    assert.notEqual(tip.getAttribute('transform'), first);
    target.listeners.pointermove({ clientX: 799, clientY: 2309 });
    const [, x, y] = tip.getAttribute('transform').match(/translate\(([\d.]+) ([\d.]+)\)/).map(Number);
    assert.ok(x / 2 >= 0 && x / 2 + 480 <= 800);
    assert.ok(y / 2 >= 0 && y / 2 + 100 <= 2310);
    target.listeners.pointerleave();
    assert.equal(tip.getAttribute('visibility'), 'hidden');
    target.listeners.focus({});
    assert.equal(tip.getAttribute('visibility'), 'visible');
    target.listeners.blur();
    assert.equal(tip.getAttribute('visibility'), 'hidden');
  }
}
listeners.keydown({ key: 'Escape' });
assert.equal(tip.getAttribute('visibility'), 'hidden');
assert.match(svg, /id="edge-tooltip" visibility="hidden" pointer-events="none"/);
console.log('通过：48条关系的标签与连线浮层、起终点、跟随、缩放、边缘避让和焦点退出。');
