/**
 * P1 架构验收:roster 清单 ↔ 插件装卸。
 *
 * 壳不再硬编码插件——一切通过 roster 行的增删表达:
 * - 删一行 = 对应能力消失(effect 回滚,级联干净);
 * - 加一行 = 能力回来(同一 Context,不重启);
 * - 服务回归时,因依赖缺失而休眠的插件自动复活(cordis reflect 语义)。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { boot, MAIN_SLOT } from '../src/index'
import { MAIN_BODY_KEY } from '../src/types'
import type { SessionsService } from '../src/types'
import type { DshClient } from '@twibot/face-protocol-client'
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

function dshOf(shell: Awaited<ReturnType<typeof boot>>): DshClient {
  return shell.ctx.dsh as DshClient
}

/** cordis 的 effect 回滚是异步链;增删行后让微任务/定时器排空。 */
const tick = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms))

describe('P1 基线:默认清单装配出 P0.5 全部行为', () => {
  it('boot 装配三插件,send 返回非空 assistant 文本', async () => {
    const host = await makeHost()
    host.scriptTexts.push('你好!我是运行在 DeepSeek Harness 里的编码助手。')

    const shell = await boot(host.baseUrl)
    const reply = await sessionsOf(shell).send('hello')
    expect(reply.trim().length).toBeGreaterThan(0)

    const state = sessionsOf(shell).state
    expect(state.sessionId).toBeTruthy()
    expect(state.messages[0]).toMatchObject({ role: 'user', content: 'hello' })
    expect(state.messages[1]).toMatchObject({ role: 'assistant', content: reply })
  })

  it('里程碑 E:杀进程重开(同宿主新 boot)→ 接管最近非空会话并恢复历史', async () => {
    const host = await makeHost()
    host.scriptTexts.push('上一世的回复')

    const first = await boot(host.baseUrl)
    await sessionsOf(first).send('前世之问')
    const firstSessionId = sessionsOf(first).state.sessionId

    // 杀进程:整个壳连同连接一起销毁,不留任何本地状态。
    first.roster.remove('dsh-connection')
    await tick()

    const second = await boot(host.baseUrl)
    await sessionsOf(second).init()
    expect(sessionsOf(second).state.sessionId).toBe(firstSessionId)
    expect(sessionsOf(second).state.messages.map((m) => m.content)).toEqual([
      '前世之问',
      '上一世的回复',
    ])
  })
})

describe('P1 验收:删一行配置 = 对应能力消失', () => {
  it("remove 'ui-chat' → slot 注销,其余服务健在", async () => {
    const host = await makeHost()
    const shell = await boot(host.baseUrl)
    expect(shell.slots.resolveSlot(MAIN_SLOT, MAIN_BODY_KEY)).toBeTruthy()

    shell.roster.remove('ui-chat')
    await tick()
    expect(shell.slots.resolveSlot(MAIN_SLOT, MAIN_BODY_KEY)).toBeUndefined()
    expect(shell.ctx.dsh).toBeTruthy()
    expect(dshOf(shell).connectionState).not.toBe('closed')
  })

  it("remove 'session-store' → 服务注销且 ui-chat 因依赖缺失一并卸载", async () => {
    const host = await makeHost()
    const shell = await boot(host.baseUrl)

    shell.roster.remove('session-store')
    await tick()
    expect(shell.ctx.sessions).toBeUndefined()
    expect(shell.slots.resolveSlot(MAIN_SLOT, MAIN_BODY_KEY)).toBeUndefined()
    expect(shell.ctx.dsh).toBeTruthy()
  })

  it("remove 'dsh-connection' → 级联回滚全部", async () => {
    const host = await makeHost()
    const shell = await boot(host.baseUrl)

    shell.roster.remove('dsh-connection')
    await tick()
    expect(shell.ctx.dsh).toBeUndefined()
    expect(shell.ctx.sessions).toBeUndefined()
    expect(shell.slots.resolveSlot(MAIN_SLOT, MAIN_BODY_KEY)).toBeUndefined()
  })
})

describe('P1 验收:加回一行 = 能力复活(同一 Context,不重启)', () => {
  it("remove 后 add 'ui-chat' → slot 重新占据", async () => {
    const host = await makeHost()
    const shell = await boot(host.baseUrl)

    shell.roster.remove('ui-chat')
    await tick()
    expect(shell.slots.resolveSlot(MAIN_SLOT, MAIN_BODY_KEY)).toBeUndefined()

    shell.roster.add({ id: 'ui-chat', module: 'ui-chat' })
    await tick()
    expect(shell.slots.resolveSlot(MAIN_SLOT, MAIN_BODY_KEY)).toBeTruthy()
  })

  it('服务回归:remove dsh 再加回 → 休眠的依赖方自动复活', async () => {
    const host = await makeHost()
    host.scriptTexts.push('复活后的回复')
    const shell = await boot(host.baseUrl)

    shell.roster.remove('dsh-connection')
    await tick()
    expect(shell.slots.resolveSlot(MAIN_SLOT, MAIN_BODY_KEY)).toBeUndefined()

    // 只把连接行加回:sessions/ui-chat 两行的 roster 条目从未动过,
    // cordis 感知服务重现后应自动重挂它们(无需清单操作)。
    shell.roster.add({
      id: 'dsh-connection',
      module: 'dsh-connection',
      config: { baseUrl: host.baseUrl },
    })
    await tick(60)
    expect(shell.ctx.dsh).toBeTruthy()
    expect(shell.ctx.sessions).toBeTruthy()
    expect(shell.slots.resolveSlot(MAIN_SLOT, MAIN_BODY_KEY)).toBeTruthy()
  })
})

describe('P1 fail-loud:错误清单立刻报错', () => {
  it('add 重复 id 抛错', async () => {
    const host = await makeHost()
    const shell = await boot(host.baseUrl)
    expect(() =>
      shell.roster.add({ id: 'ui-chat', module: 'ui-chat' }),
    ).toThrow(/duplicate id "ui-chat"/)
  })

  it('add 与现存行同 module 的不同 id 抛错(每模块至多一个存活实例)', async () => {
    const host = await makeHost()
    const shell = await boot(host.baseUrl)
    expect(() =>
      shell.roster.add({ id: 'ui-chat-2', module: 'ui-chat' }),
    ).toThrow(/already mounted as "ui-chat"/)
  })

  it('未知模块名:同步阶段大声报错,该行不产生任何服务', async () => {
    const host = await makeHost()
    const shell = await boot(host.baseUrl)
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      shell.roster.add({ id: 'ghost', module: 'no-such-module' })
      await tick(40)
      expect(errSpy).toHaveBeenCalled()
      expect(shell.ctx.ghost).toBeUndefined()
      expect(shell.roster.get().some((entry) => entry.id === 'ghost')).toBe(true)
    } finally {
      errSpy.mockRestore()
    }
  })
})
