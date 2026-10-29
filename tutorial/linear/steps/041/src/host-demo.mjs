import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync } from "node:fs"
import { resolve, join } from "node:path"
import { Host } from "./host.mjs"

// 运行目录是自己的PROJECT；先确保tmp存在，再生成独立数据目录。
const temporaryRoot = resolve("tmp")
mkdirSync(temporaryRoot, { recursive: true })
// 保留本次演示文件，程序退出后可按打印出的路径查看。
const home = mkdtempSync(join(temporaryRoot, "host-041-"))
let host = new Host(home)

try {
  // 同一个管理器打开两个会话；owner只是本教程的所属者标记。
  const alice = host.create({ cwd: process.cwd(), owner: "alice" })
  const bob = host.create({ cwd: process.cwd(), owner: "bob" })
  const sessionId = alice.header.id
  console.log("同时打开的会话数：", host.loaded.size)
  assert.equal(host.loaded.size, 2)

  // Agent负责执行，Events和Journal负责保存消息。
  alice.agent.submit("Alice的第一条消息")
  await alice.agent.idle()

  // 关闭Alice的运行对象，保留她的历史文件。
  await host.closeSession(sessionId, "alice")
  console.log("关闭Alice后会话数：", host.loaded.size)
  assert.equal(host.loaded.size, 1)

  // 给Bob继续提交任务，确认他的Agent仍能工作。
  bob.agent.submit("Bob继续工作")
  await bob.agent.idle()
  const bobReply = bob.session.read().findLast(event => event.type === "message/assistant")
  console.log("Bob的回复：", bobReply.data.content)
  assert.equal(bobReply.data.content, "[离线演示] Bob继续工作")

  // open创建新的Alice会话对象，从磁盘找回旧消息。
  const reopened = host.open(sessionId, "alice")
  const oldReply = reopened.session.read().findLast(event => event.type === "message/assistant")
  console.log("重新打开Alice后的旧回复：", oldReply.data.content)
  assert.equal(oldReply.data.content, "[离线演示] Alice的第一条消息")
  assert.notEqual(reopened.agent, alice.agent)

  // 先正常关闭旧管理器，再新建管理器；仍使用同一个数据目录。
  await host.close()
  host = new Host(home)
  assert.equal(host.loaded.size, 0)
  assert.equal(host.list("alice").length, 1)
  console.log("只列出会话，尚未打开：", host.loaded.size)
  assert.equal(host.loaded.size, 0)

  // 新管理器不能使用旧Map，只能重新读取磁盘文件。
  const restored = host.open(sessionId, "alice")
  const restoredReply = restored.session.read().findLast(event => event.type === "message/assistant")
  console.log("新建管理器后的旧回复：", restoredReply.data.content)
  assert.equal(restoredReply.data.content, oldReply.data.content)
  console.log("本次数据目录：", home)
  console.log("Alice的会话id：", sessionId)
} finally {
  // 正常退出会释放日志句柄和锁，历史文件继续保留。
  await host.close()
}
