import { Context } from '@deepseek-ai/cordis'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'

/** 页面会话互斥锁 + 12s 间隔令牌桶（宁慢勿罚，账挂账号不值得）。 */
class PageGuard {
  private lastAt = 0
  private lock: Promise<void> = Promise.resolve()

  /** 串行 + 最短间隔。 */
  async enter(): Promise<() => void> {
    const prev = this.lock
    let release!: () => void
    this.lock = new Promise<void>((r) => (release = r))
    await prev
    const wait = this.lastAt + 12_000 - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    this.lastAt = Date.now()
    return release
  }
}

export interface BrowserSession {
  browser: Browser
  context: BrowserContext
  page: Page
  close(): Promise<void>
}

export interface SessionService {
  /** 启动带凭据的浏览器会话；调用方负责 close()。无凭据/无浏览器时抛错。 */
  launch(): Promise<BrowserSession>
  /** 最近调用统计（_stats 用）。 */
  stats(): { launches: number; lastAt: number | null }
  /** 探测当前登录态：true=需要登录（登录墙），false=已登录或无法判定。用 .home 页。 */
  verify(page: Page): Promise<{ valid: boolean; reason?: string }>
}

export const name = 'core-session'
export const inject = ['credential', 'api']

export interface Config {
  /** 页面 UA。 */
  userAgent: string
  /** 显式代理（http://host:port）；缺省读 TWITTER_PROXY → HTTPS_PROXY/https_proxy → ALL_PROXY。 */
  proxy?: string
}

export const X_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

/** 正文/URL 命中即视为登录墙（复用旧项目文案与探测）。 */
const LOGIN_WALL_MARKERS = ['Don’t miss what’s happening', 'New to X', 'Sign in to X', '/i/flow/login']

export function detectLoginWall(page: Page, bodyText: string): boolean {
  if (page.url().includes('/i/flow/login')) return true
  return LOGIN_WALL_MARKERS.some((m) => bodyText.includes(m))
}

export function apply(ctx: Context, config: Config): void {
  const guard = new PageGuard()
  let launches = 0
  let lastAt: number | null = null
  const openSessions = new Set<BrowserSession>()

  const service: SessionService = {
    async launch() {
      const creds = (ctx as any).credential as {
        resolveCookies(): Array<{ name: string; value: string; domain: string; path: string; httpOnly?: boolean; secure?: boolean; sameSite?: string }>
        hasRequired(): boolean
      }
      const release = await guard.enter()
      let session: BrowserSession | null = null
      try {
        // 显式空串/空白 = 不用代理（本地 mock/调试）；未配置则按 env 链回落
        const proxy =
          (config.proxy ?? '').trim() ||
          process.env['TWITTER_PROXY'] ||
          process.env['HTTPS_PROXY'] ||
          process.env['https_proxy'] ||
          process.env['ALL_PROXY'] ||
          undefined
        const launchOpts: Parameters<typeof chromium.launch>[0] = { headless: true }
        if (proxy) launchOpts.proxy = { server: proxy }
        const browser: Browser = await chromium.launch(launchOpts)
        const context = await browser.newContext({
          userAgent: config.userAgent || X_UA,
          viewport: { width: 1280, height: 900 },
          locale: 'en-US',
        })
        const cookies = creds.resolveCookies()
        if (cookies.length > 0) {
          await context.addCookies(cookies as Parameters<typeof context.addCookies>[0])
        }
        const page = await context.newPage()
        let closed = false
        const close = async () => {
          if (closed) return
          closed = true
          await browser.close().catch(() => {})
          release()
          openSessions.delete(session!)
        }
        session = { browser, context, page, close }
        openSessions.add(session)
        launches++
        lastAt = Date.now()
        return session
      } catch (e) {
        release()
        throw e
      }
    },

    stats() {
      return { launches, lastAt }
    },

    async verify(page) {
      // 以主页为探针：出现登录墙即无效（已登录/无墙判定为有效由调用方按需求处理）
      const body = await page.evaluate(() => document.body?.innerText?.slice(0, 600) ?? '').catch(() => '')
      if (detectLoginWall(page, body)) return { valid: false, reason: 'AUTH_FAILED' }
      return { valid: true }
    },
  }

  ctx.provide('session', service)

  // 卸载：回收所有还开着的浏览器
  ctx.effect(() => {
    return async () => {
      await Promise.all([...openSessions].map((s) => s.close()))
    }
  }, 'close-sessions')

  // _stats 端点
  const api = (ctx as any).api
  if (api) {
    api.get('/api/_stats', (c) => {
      return c.json({ ok: true, data: { session: service.stats() }, source: 'stats', elapsedMs: 0 })
    })
  }
}