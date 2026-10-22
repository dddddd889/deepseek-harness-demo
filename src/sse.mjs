/** 字节块不是事件；用流式 UTF-8 解码，再按空行还原 SSE 帧。 */
export async function* sse(chunks) {
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let buffer = ''
  const frames = function* () {
    let match
    while ((match = /\r?\n\r?\n/.exec(buffer))) {
      const frame = buffer.slice(0, match.index)
      buffer = buffer.slice(match.index + match[0].length)
      const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n')
      if (data) yield data
    }
  }
  for await (const chunk of chunks) { buffer += decoder.decode(chunk, { stream: true }); yield* frames() }
  buffer += decoder.decode(); yield* frames()
  if (buffer.trim() && !buffer.trim().startsWith(':')) throw Error('SSE 尾帧未完成')
}
