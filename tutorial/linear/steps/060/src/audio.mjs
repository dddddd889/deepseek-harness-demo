/** ASR是外部模型提供方，不把录音base64混入普通文本prompt。 */
export async function transcribe(bytes, { url, key, model }, signal, fetcher = fetch) {
  if (!url || !key || !model) throw Error('语音提供方尚未配置')
  const form = new FormData(); form.set('file', new Blob([bytes], { type: 'audio/wav' }), 'recording.wav'); form.set('model', model)
  const response = await fetcher(url, { method: 'POST', signal, headers: { authorization: 'Bearer ' + key }, body: form })
  if (!response.ok) throw Error('语音HTTP ' + response.status)
  const value = await response.json(); if (typeof value.text !== 'string') throw Error('语音结果缺少text')
  return value.text
}

/** 翻译仍走现有模型接口，可以复用路由、取消和凭据政策。 */
export async function translate(text, language, model, signal) {
  let output = '', ended = false
  for await (const part of model.stream({ messages: [{ role: 'user', content: text }], tools: [], config: { system: '把用户文本翻译为' + language + '，只输出译文。' }, signal })) {
    if (part.kind === 'text') output += part.text
    if (part.kind === 'finish') ended = part.reason === 'stop'
  }
  if (!ended) throw Error('翻译未完整结束')
  return output
}
