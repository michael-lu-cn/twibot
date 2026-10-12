/**
 * A2: apiClient 信封契约（对齐 web 版 lib/api.ts 语义）。
 * 覆盖：Ok/Err 解析、ERROR_HINTS 文案、baseUrl 拼接、图片代理、网络错误、post body。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createApiClient, ERROR_HINTS, isOk } from '../src/lib/api-client'

const BASE = 'http://127.0.0.1:12000'

function stubFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(impl))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('api-client 信封', () => {
  it('Ok 载荷透传', async () => {
    stubFetch(async () =>
      new Response(JSON.stringify({ ok: true, data: { configured: true, keys: ['ct0'], source: 'file' }, source: 'database', elapsedMs: 1 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const api = createApiClient(BASE)
    const r = await api.credentialStatus()
    expect(isOk(r)).toBe(true)
    if (isOk(r)) {
      expect(r.data.configured).toBe(true)
      expect(r.data.keys).toEqual(['ct0'])
    }
  })

  it('Err 载荷透传（NOT_SYNCED 等）', async () => {
    stubFetch(async () =>
      new Response(JSON.stringify({ ok: false, error: { code: 'NOT_SYNCED', message: '本地还没有数据' } }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const r = await createApiClient(BASE).feed(20)
    expect(isOk(r)).toBe(false)
    if (!isOk(r)) {
      expect(r.error.code).toBe('NOT_SYNCED')
      expect(ERROR_HINTS[r.error.code]).toContain('本地还没有数据')
    }
  })

  it('非 JSON 响应 → NETWORK 错误', async () => {
    stubFetch(async () => new Response('internal error', { status: 502 }))
    const r = await createApiClient(BASE).feed(20)
    expect(!isOk(r) && r.error.code).toBe('NETWORK')
  })

  it('fetch 抛错 → NETWORK 错误', async () => {
    stubFetch(async () => {
      throw new Error('ECONNREFUSED')
    })
    const r = await createApiClient(BASE).feed(20)
    expect(!isOk(r) && r.error.code).toBe('NETWORK')
    expect(!isOk(r) && r.error.message).toContain('无法连接后端')
  })
})

describe('api-client 请求形态', () => {
  it('GET 路径拼接（去尾部斜杠）', async () => {
    stubFetch(async (url) => new Response(JSON.stringify({ ok: true, data: { tweets: [], syncedAt: null }, source: 'db', elapsedMs: 0 }), { status: 200 }))
    await createApiClient('http://127.0.0.1:12000/').bookmarks(5000)
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('http://127.0.0.1:12000/api/bookmarks?limit=5000')
    // 第二参不再是 undefined:带上了超时用的 AbortSignal(网络被冻结时不至于无限等待)。
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('POST body 与 content-type', async () => {
    stubFetch(async () => new Response(JSON.stringify({ ok: true, data: { configured: true, keys: ['ct0'] }, source: 'db', elapsedMs: 0 }), { status: 200 }))
    await createApiClient(BASE).saveCredential('auth_token=x; ct0=y')
    const [, init] = vi.mocked(fetch).mock.calls[0]
    expect(init?.method).toBe('POST')
    expect(init?.headers).toEqual({ 'content-type': 'application/json' })
    expect(JSON.parse(String(init?.body))).toEqual({ cookie: 'auth_token=x; ct0=y' })
  })

  it('图片代理 URL 生成', () => {
    const api = createApiClient('http://127.0.0.1:12000')
    expect(api.imgProxyUrl('https://pbs.twimg.com/a.png')).toBe(
      'http://127.0.0.1:12000/api/img-proxy?url=https%3A%2F%2Fpbs.twimg.com%2Fa.png',
    )
    expect(api.imgProxyUrl(null)).toBeUndefined()
  })
})