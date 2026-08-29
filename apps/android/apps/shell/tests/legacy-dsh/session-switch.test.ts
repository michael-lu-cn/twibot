/**
 * S0 契约验收:会话切换能力(SessionsService.switchTo / newSession)。
 * 服务端是真相源:切换 = 换投影 + 整页重拉;新建 = 换空投影。
 * 这两个方法是 drawer-sessions 抽屉插件的依赖契约,先行钉死。
 */
import { afterEach, describe, expect, it } from 'vitest'

import { boot } from '../src/index'
import type { SessionsService } from '../src/types'
import { MockHost } from '../../../packages/protocol-client/tests/mock-host'

const hosts: MockHost[] = []

async function makeHost(): Promise<MockHost> {
  const host = new MockHost()
  await host.listen()
  hosts.push(host)
  return host
}

afterEach(() => {
  for (const host of hosts) host.close()
  hosts.length = 0
})

function sessionsOf(shell: Awaited<ReturnType<typeof boot>>): SessionsService {
  return shell.ctx.sessions as SessionsService
}

describe('S0 契约:会话切换', () => {
  it('newSession 返回新 id 并清空投影;switchTo 切回旧会话并整页重拉历史', async () => {
    const host = await makeHost()
    const shell = await boot(host.baseUrl)
    const sessions = sessionsOf(shell)

    // 会话 A:init → 一轮对话
    await sessions.init()
    const firstId = sessions.state.sessionId as string
    expect(firstId).toBeTruthy()
    await sessions.send('hello')
    expect(sessions.state.messages.map((m) => m.content)).toEqual(['hello', 'echo:hello'])

    // 新建会话 B:新 id、投影清空、列表可见两条
    const newId = await sessions.newSession()
    expect(newId).not.toBe(firstId)
    expect(sessions.state.sessionId).toBe(newId)
    expect(sessions.state.messages).toEqual([])

    const items = await (shell.ctx.dsh as { listSessions(): Promise<unknown[]> }).listSessions()
    expect(items.map((item) => (item as { sessionId: string }).sessionId).sort()).toEqual(
      [firstId, newId].sort(),
    )

    // 切回 A:投影恢复 A 的历史(与首次 send 时的内容一致)
    await sessions.switchTo(firstId)
    expect(sessions.state.sessionId).toBe(firstId)
    expect(sessions.state.messages.map((m) => m.content)).toEqual(['hello', 'echo:hello'])

    // 重复切换同会话:幂等,不触发重拉导致的渲染抖动(消息内容不变即可)
    await sessions.switchTo(firstId)
    expect(sessions.state.messages.map((m) => m.content)).toEqual(['hello', 'echo:hello'])
  })
})