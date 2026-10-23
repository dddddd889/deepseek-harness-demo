import { HarnessSDK } from 'harness-own/sdk'
// 编译消费者只验证公开契约，不启动模型或子进程。
async function consumer(home: string, cwd: string) {
  const sdk = new HarnessSDK({ home, cwd })
  try { const header = await sdk.create(); const result = await sdk.run(header.id, 'hello'); return result.ending.reason }
  finally { await sdk.close() }
}
void consumer
