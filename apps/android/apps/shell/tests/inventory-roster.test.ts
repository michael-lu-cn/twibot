/**
 * P2 清单来源:宿主 inventory → roster 合成。
 *
 * - 纯策略(composeRoster):绑定/enabled/deferred/旧宿主形状;
 * - 装配级(boot × MockHost):清单可用时走投影、不可用时回退本地基线。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { boot, type RosterEntry } from '../src/index'
import { composeRoster } from '../src/roster'
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
  vi.restoreAllMocks()
})

const item = (overrides: Record<string, unknown>) => ({
  entryId: String(overrides['moduleName'] ?? 'x'),
  moduleName: String(overrides['moduleName'] ?? 'x'),
  enabled: overrides['enabled'] !== false,
  fiberPhase: 'active' as const,
  ...overrides,
})

describe('composeRoster 纯策略', () => {
  it('基线一行永远在场(ui-hello 空壳);空清单 = M0 默认行为', () => {
    const { entries, deferred } = composeRoster({ baseUrl: 'http://h', inventory: [] })
    expect(entries.map((entry: RosterEntry) => entry.id)).toEqual(['ui-hello'])
    expect(deferred).toEqual([])
  })

  it('绑定的 enabled 宿主条目追加进清单;disabled 跳过', () => {
    const { entries, deferred } = composeRoster({
      baseUrl: 'http://h',
      inventory: [
        item({ moduleName: 'cordis:panel', enabled: true }),
        item({ moduleName: 'cordis:hidden', enabled: false }),
      ],
      bindings: { 'cordis:panel': 'ui-chat', 'cordis:hidden': 'session-store' },
    })
    expect(entries.some((entry) => entry.id === 'cordis:panel')).toBe(true)
    expect(entries.some((entry) => entry.id === 'cordis:hidden')).toBe(false)
    expect(deferred).toEqual([])
  })

  it('未绑定但携带 url/rev 的条目进入 deferred(远端 chunk 候补)', () => {
    const { entries, deferred } = composeRoster({
      baseUrl: 'http://h',
      inventory: [
        item({
          moduleName: '@deepseek-ai/dsh-client-ui-conversation',
          url: '/plugins/@deepseek-ai/dsh-client-ui-conversation/client.js?rev=abc123def456',
          rev: 'abc123def456',
        }),
        // 旧宿主形状:无 url/rev 的未绑定条目直接忽略
        item({ moduleName: 'cordis:boring' }),
      ],
    })
    expect(entries).toHaveLength(1)
    expect(deferred).toEqual([
      {
        moduleName: '@deepseek-ai/dsh-client-ui-conversation',
        url: '/plugins/@deepseek-ai/dsh-client-ui-conversation/client.js?rev=abc123def456',
        rev: 'abc123def456',
      },
    ])
  })

  it('ui-hello 行的 baseUrl 始终取运行时输入', () => {
    const { entries } = composeRoster({ baseUrl: 'http://from-input', inventory: [] })
    expect(entries[0]).toMatchObject({ id: 'ui-hello', config: { baseUrl: 'http://from-input' } })
  })
})

describe('boot × MockHost:装配级接线(清单来源 = __DSH_BOOT__ 图谱)', () => {
  it('宿主图谱携带 bundle 行 → 候补被记录,本地行为不变', async () => {
    const host = await makeHost()
    host.rootHtml =
      '<html><head><script>globalThis["__DSH_BOOT__"] = {"entries":[' +
      '{"id":"@deepseek-ai/dsh-client-ui-settings","url":"/plugins/@deepseek-ai/dsh-client-ui-settings/client.js?rev=fff000aaa111","rev":"fff000aaa111"}' +
      ']}</script></head></html>'
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

    const shell = await boot(host.baseUrl)
    expect(shell.roster.get().map((entry) => entry.id)).toEqual(['ui-hello'])
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining('远端 chunk 候补 1 个'),
    )
  })

  it('宿主首页无图谱 → 回退本地基线,boot 照常成功', async () => {
    const host = await makeHost() // rootHtml=null → GET / 405 → 解析为空
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

    const shell = await boot(host.baseUrl)
    expect(infoSpy).not.toHaveBeenCalled()
    expect(shell.roster.get()).toHaveLength(1)
  })
})
