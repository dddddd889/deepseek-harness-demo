/** 仅发送基础设施探针，证明 OTLP 接收可用，不代替业务 exporter。 */
export {}

// 探针在本机执行，通过已发布的本机端口连接 Collector；改端口时同步设置以下环境变量。
const endpoint = process.env.OTEL_LOGS_ENDPOINT ?? 'http://127.0.0.1:14318/v1/logs'
const healthEndpoint = process.env.OTEL_HEALTH_ENDPOINT ?? 'http://127.0.0.1:13133/'

/** 有界等待健康端点，避免把进程已启动误当成接收器已就绪。 */
async function waitForCollector(): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const response = await fetch(healthEndpoint, { signal: AbortSignal.timeout(1000) })
      if (response.ok) return
    } catch {
      // 首次启动可能尚未监听端口，下一轮继续检查。
    }
    await Bun.sleep(250)
  }
  throw new Error('Collector 健康检查超时')
}

await waitForCollector()
// 固定的人工探针与真实 Agent 事件明确分开。
const body = {
  resourceLogs: [{
    resource: { attributes: [{ key: 'service.name', value: { stringValue: 'from-zero-infra-probe' } }] },
    scopeLogs: [{
      scope: { name: 'infra-check' },
      logRecords: [{
        timeUnixNano: String(BigInt(Date.now()) * 1_000_000n),
        severityNumber: 9,
        severityText: 'INFO',
        body: { stringValue: 'Collector 接收探针；尚未接入 Harness' },
      }],
    }],
  }],
}
const response = await fetch(endpoint, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body), signal: AbortSignal.timeout(5000),
})
if (!response.ok) throw new Error(`OTLP 接收失败：HTTP ${response.status}`)
const result = await response.json() as { partialSuccess?: { rejectedLogRecords?: string | number } }
if (Number(result.partialSuccess?.rejectedLogRecords ?? 0) > 0) throw new Error('Collector 拒绝了探针日志')
console.log('接收成功；请在 Collector 日志中查找 from-zero-infra-probe。业务 exporter 仍需自己实现。')
