// 真实API验收必须明确配置Key，不能偷偷回退到固定模型。
if (!process.env.DEEPSEEK_API_KEY) throw Error("请先在.env填写自己的DEEPSEEK_API_KEY")
await import("./demo.mjs")
