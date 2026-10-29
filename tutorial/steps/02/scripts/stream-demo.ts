import { fakeModel } from '../src/fake-model';
// 流是一个接一个到达的事件；这里先直接观察，不提前拼成完整答案。
for await (const part of fakeModel([{ role: 'user', content: '你好' }], [], new AbortController().signal)) {
  console.log(part);
}
