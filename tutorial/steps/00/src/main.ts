// 从第三个参数起，才是用户交给程序的任务。
const prompt = process.argv.slice(2).join(' ').trim();
if (!prompt) {
  console.error('用法：bun run dev "你的任务"');
  process.exit(1);
}
console.log(`收到任务：${prompt}`);
