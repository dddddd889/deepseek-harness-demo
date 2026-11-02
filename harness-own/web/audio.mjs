/** 麦克风只在用户点击后申请；停止时关闭媒体轨道，不留后台录音。 */
export async function recordAudio() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true }), recorder = new MediaRecorder(stream), chunks = []
  recorder.ondataavailable = event => chunks.push(event.data)
  recorder.start()
  return { stop: () => new Promise((resolve, reject) => {
    recorder.onerror = event => { stream.getTracks().forEach(track => track.stop()); reject(event.error) }
    recorder.onstop = () => { stream.getTracks().forEach(track => track.stop()); resolve(new Blob(chunks, { type: recorder.mimeType })) }
    recorder.stop()
  }) }
}
