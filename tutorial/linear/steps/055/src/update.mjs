import { verify, createHash } from 'node:crypto'
import { Store } from './storage.mjs'

/** 更新只信任固定公钥签名的原始manifest字节，不能信任下载URL自己声称的hash。 */
export class Updates {
  constructor(path, publicKey, target) { this.store = new Store(path); this.key = publicKey; this.target = target }
  /** 拒绝跨平台、降级与被篡改的元数据。 */
  admit(raw, signature, currentVersion) {
    if (!verify(null, Buffer.from(raw), this.key, Buffer.from(signature, 'base64'))) throw Error('更新签名无效')
    const manifest = JSON.parse(raw)
    const numbers = value => { if (!/^\d+\.\d+\.\d+$/.test(value)) throw Error('更新版本不合法'); return value.split('.').map(Number) }
    const next = numbers(manifest.version), current = numbers(currentVersion)
    let newer = false
    for (let index = 0; index < 3; index++) { if (next[index] !== current[index]) { newer = next[index] > current[index]; break } }
    if (!newer || manifest.target !== this.target || !/^[a-f0-9]{64}$/.test(manifest.sha256)) throw Error('更新目标或版本不合法')
    this.store.update(() => ({ status: 'admitted', manifest, previous: currentVersion }))
    return manifest
  }
  /** 安装器由平台提供；失败保留旧版本资格，不把准备完成当安装成功。 */
  async apply(bytes, installer) {
    const state = this.store.read()
    if (state.status !== 'admitted' || createHash('sha256').update(bytes).digest('hex') !== state.manifest.sha256) throw Error('更新载荷不合法')
    this.store.update(() => ({ ...state, status: 'installing' }))
    try { await installer(bytes); this.store.update(() => ({ ...state, status: 'awaiting-new-version-smoke' })) }
    catch (error) { this.store.update(() => ({ ...state, status: 'failed-keep-old', error: error.message })); throw error }
  }
}
