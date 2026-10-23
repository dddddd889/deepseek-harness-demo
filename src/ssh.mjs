import { execute } from './process.mjs'

/** POSIX argv 的单引号编码；Host 名称单独验证，不能变成 ssh 参数。 */
export function quote(value) { return "'" + String(value).replaceAll("'", "'\\''") + "'" }

/** 同一个远端对象同时提供文件和执行，避免本地读/远端执行混在一起。 */
export class SSH {
  constructor(host, workspace, runner = execute) {
    if (!/^[a-zA-Z0-9_.@-]+$/.test(host) || host.startsWith('-')) throw Error('SSH 主机不合法')
    if (!workspace.startsWith('/')) throw Error('远端工作区必须绝对路径')
    this.host = host; this.workspace = workspace; this.runner = runner
  }
  /** 命令仅在远端执行，配置与秘密不由模型拼 ssh 命令。 */
  run(argv, signal) {
    return this.runner({ command: 'ssh', args: ['-T', '-o', 'BatchMode=yes', this.host, 'cd ' + quote(this.workspace) + ' && exec ' + argv.map(quote).join(' ')] }, signal)
  }
  /** 远端文件路径拒绝向上跳转；更强隔离仍交给远端沙箱。 */
  async read(path, signal) {
    if (path.startsWith('/') || path.split(/[\\/]/).includes('..')) throw Error('远端路径越界')
    const result = await this.run(['cat', '--', path], signal)
    if (result.code !== 0) throw Error('远端读取失败：' + result.output)
    return result.output
  }
  async write(path, text, signal) {
    if (path.startsWith('/') || path.split(/[\\/]/).includes('..')) throw Error('远端路径越界')
    const encoded = Buffer.from(text).toString('base64')
    // 只执行固定模板；文本通过base64编码，不能变成shell操作符。
    return this.run(['sh', '-c', 'printf %s ' + quote(encoded) + ' | base64 -d > ' + quote(path)], signal)
  }
}