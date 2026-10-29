import { test, expect } from 'bun:test';
import { Kernel } from '../src/plugins';
import { Tools } from '../src/tools';
// 用重复注册稳定制造第二次安装失败，观察第一次登记是否回滚。
test('插件安装失败时回滚已经注册的 effect', () => {
  const kernel = new Kernel();
  const tools = new Tools();
  const tool = { name: 'x', description: '测试', parameters: {}, mutates: false, async run() { return 'ok'; } };
  expect(() => kernel.install(effect => {
    effect(() => tools.register(tool));
    effect(() => tools.register(tool));
  })).toThrow('重名');
  expect(tools.specs()).toHaveLength(0);
  kernel.dispose();
});
