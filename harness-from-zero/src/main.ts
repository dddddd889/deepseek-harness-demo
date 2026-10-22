// 取出用户传入的任务；前两个参数是运行时和脚本路径。
const promptInput = process.argv.slice(2).join(" ").trim();

// 没有任务时，告诉用户怎样运行，并以失败状态退出。
if (!promptInput) {
  console.error('用法：bun run dev "你的任务"');
  process.exit(1);
}

// 先确认入口收到任务，下一步再把任务交给模型。
console.log(`收到任务：${promptInput}`);