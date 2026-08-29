/**
 * M1: ui-router 组合路由装配。
 * 凭据状态决定 main/body 从 AuthScreen 还是 FeedScreen 渲染；失败安全默认 AuthScreen。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { boot, MAIN_SLOT } from '../src/index'
import { MAIN_BODY_KEY } from '../src/types'

function stubFetch(credentialBody: unknown, fail = false) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (fail) throw new Error('ECONNREFUSED')
      if (String(url).includes('/api/credential/status')) {
        return new Response(JSON.stringify(credentialBody), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      // 宿主首页（__DSH_BOOT__ 清单探测）：无图谱 → 回退本地基线
      return new Response('<html></html>', { status: 200 })
    }),
  )
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 30))

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ui-router 装配', () => {
  it('凭据已配置 → main/body = FeedScreen', async () => {
    stubFetch({ ok: true, data: { configured: true, keys: ['ct0'], source: 'file' }, source: 'db', elapsedMs: 0 })
    const shell = await boot('http://host')
    await settle()
    const winner = shell.slots.resolveSlot(MAIN_SLOT, MAIN_BODY_KEY)
    expect(winner).toBeTruthy()
    expect((winner!.entry as { component: { name?: string } }).component.name).toContain('FeedScreen')
  })

  it('未配置 → main/body = AuthScreen', async () => {
    stubFetch({ ok: true, data: { configured: false, keys: [], source: 'none' }, source: 'db', elapsedMs: 0 })
    const shell = await boot('http://host')
    await settle()
    const winner = shell.slots.resolveSlot(MAIN_SLOT, MAIN_BODY_KEY)
    expect(winner).toBeTruthy()
    expect((winner!.entry as { component: { name?: string } }).component.name).toContain('AuthScreen')
  })

  it('凭据探测失败 → 安全默认 AuthScreen', async () => {
    stubFetch({}, true)
    const shell = await boot('http://host')
    await settle()
    const winner = shell.slots.resolveSlot(MAIN_SLOT, MAIN_BODY_KEY)
    expect(winner).toBeTruthy()
    expect((winner!.entry as { component: { name?: string } }).component.name).toContain('AuthScreen')
  })
})