import { Context } from '@deepseek-ai/cordis'
import type { Page } from 'playwright'

// ─── 统一业务错误（同 sync-feed 定义，后续共享到 packages/core）────────────

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number = 500,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export const ErrorCodes = {
  NO_COOKIES: 'NO_COOKIES',
  NO_ME: 'NO_ME',
  AUTH_FAILED: 'AUTH_FAILED',
  RATE_LIMITED: 'RATE_LIMITED',
  SCRAPE_FAILED: 'SCRAPE_FAILED',
  NOT_SYNCED: 'NOT_SYNCED',
  BAD_REQUEST: 'BAD_REQUEST',
} as const

export function errorResponse(e: unknown): { status: number; body: unknown } {
  if (e instanceof ApiError) {
    return { status: e.status, body: { ok: false, error: { code: e.code, message: e.message } } }
  }
  const message = e instanceof Error ? e.message : String(e)
  return { status: 500, body: { ok: false, error: { code: 'INTERNAL', message } } }
}

// ─── 关注用户类型与解析（从旧项目 following.ts / page-scripts.mjs 平移）───

export interface FollowingUser {
  userId?: string
  name: string
  handle: string
  bio: string
  avatarUrl: string
}

/** 新版 User 结构 → FollowingUser（惰性字段，缺啥补啥）。 */
export function extractGqlUser(r: Record<string, any> | undefined): FollowingUser | null {
  if (!r?.core?.screen_name) return null
  return {
    name: r.core?.name ?? '',
    handle: r.core.screen_name,
    bio: r.profile_bio?.description ?? '',
    avatarUrl: r.avatar?.image_url ?? '',
    userId: r.rest_id ?? undefined,
  }
}

/** 书签页侧边栏提取当前登录账号 handle（函数体随 evaluate 注入页面，不定义命名函数）。 */
export function extractCurrentUser() {
  const acc = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]')
  const text = acc?.textContent ?? ''
  const at = text.lastIndexOf('@')
  const handle = at >= 0 ? text.slice(at + 1).trim() : ''
  return handle
}

/** 从关注页 UserCell 提取用户（名字/handle/bio/头像，兼容中英文 UI）。 */
export function extractCell(cell: Element): { name: string; handle: string; bio: string; avatarUrl: string } | null {
  const img = cell.querySelector('img[src*="profile_images"], img[src*="/profile_"]')
  const avatarUrl = img?.getAttribute('src') ?? ''
  let raw = cell.textContent ?? ''

  // 1) 剥离按钮无障碍文本（中英文 aria）：点击 关注 X / Click to Follow X / Follow X
  raw = raw.replace(
    /(?:点击\s*(?:关注|取消关注|已关注)|Click to\s*(?:Follow|Unfollow|Following)|\s(?:Follow|Following|Unfollow))\s*@?([\w_]+?)(?=[^\w_]|$)/gi,
    ' ',
  )
  // 2) 剥离紧跟 handle 的按钮词：@handleFollow / @handle关注 / @handle正在关注（非贪婪避免吞 bio）
  raw = raw.replace(/@([\w_]+?)(?:Follow(?:ing|Click)?|Unfollow|关注|已关注|互相关注|取消关注|正在关注)(?=\s|$)/g, '@$1')
  // 3) 剥离尾部按钮文本
  raw = raw.replace(/(关注|已关注|互相关注|取消关注|Follow|Following|Unfollow)$/i, '').trim()
  // 4) 剥离自动翻译提示
  raw = raw.replace(/由 Grok 翻译/g, '').trim()

  // 5) 第一个 @token 是 handle，之前是 name，之后是 bio
  const atMatch = raw.match(/@([\w_]+)/)
  const name = atMatch ? raw.slice(0, atMatch.index).trim() : raw.trim()
  const handle = atMatch ? atMatch[1] : ''
  const bio = atMatch ? raw.slice(atMatch.index + atMatch[0].length).trim() : ''

  if (!handle && !name) return null
  return { name, handle, bio, avatarUrl }
}

// ─── 服务 ────────────────────────────────────────────────────────────────

export const name = 'sync-following'
export const inject = ['session', 'store', 'api', 'credential']

export interface Config {
  /** 单次同步条数上限。 */
  limit: number
  /** 滚动轮数。 */
  scrolls: number
  /** X 基址（本地调试/mock 可覆盖；默认 https://x.com）。 */
  baseUrl?: string
}

const NAV_TIMEOUT_MS = 30_000
const SCROLL_WAIT_MS = 1200
const MAX_SCROLLS = 8
const HANDLE_TTL_MS = 30 * 60 * 1000
const KV_CURRENT_HANDLE = 'current_handle'

export function apply(ctx: Context, config: Config): void {
  const session = ctx.session as any
  const store = ctx.store as any
  const api = ctx.api as any
  const base = (config.baseUrl ?? 'https://x.com').replace(/\/$/, '')

  // handle → 缓存（handle 不变；30min TTL 兜底 kv 持久化）
  let cachedHandle: { handle: string; at: number } | null = null

  /** 快路径：内存缓存 → kv 持久化。都不在返回 null（不开浏览器）。 */
  function resolveHandleCached(): string | null {
    if (cachedHandle && Date.now() - cachedHandle.at < HANDLE_TTL_MS) return cachedHandle.handle
    const persisted = store.kvGet(KV_CURRENT_HANDLE)
    if (persisted) {
      cachedHandle = { handle: persisted, at: Date.now() }
      return persisted
    }
    return null
  }

  /** 解析当前登录用户 handle：缓存 → kv → 书签页 DOM（慢，仅首次）。 */
  async function resolveCurrentHandle(): Promise<string> {
    const fast = resolveHandleCached()
    if (fast) return fast
    const s = await session.launch()
    const { page } = s
    try {
      await page.goto(`${base}/i/bookmarks`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS })
      await page
        .waitForFunction(
          () => {
            const t = document.body?.innerText ?? ''
            return (
              !!document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]') ||
              t.includes("Don't miss what's happening") ||
              t.includes('New to X')
            )
          },
          { timeout: NAV_TIMEOUT_MS },
        )
        .catch(() => {})
      const body = await page.evaluate(() => document.body?.innerText?.slice(0, 500) ?? '').catch(() => '')
      if (session.verify && (await session.verify(page).then((v: { valid: boolean }) => !v.valid).catch(() => false))) {
        throw new ApiError(ErrorCodes.AUTH_FAILED, '登录态失效：无法访问书签页，请更新登录凭据', 401)
      }
      if (!body) throw new ApiError(ErrorCodes.SCRAPE_FAILED, '未能加载书签页', 502)
      const handle = await page.evaluate(extractCurrentUser).catch(() => '')
      if (!handle) throw new ApiError(ErrorCodes.SCRAPE_FAILED, '无法识别当前登录用户', 502)
      cachedHandle = { handle, at: Date.now() }
      store.kvSet(KV_CURRENT_HANDLE, handle)
      return handle
    } finally {
      await s.close()
    }
  }

  /**
   * 抓取当前用户关注列表（页面拦截 Following GraphQL + 滚动翻页 + DOM fallback）。
   * 返回 { users, targetUserId }（targetUserId 从 Following 响应提取，供落库）。
   */
  async function fetchFollowing(handle: string, limit: number): Promise<{ users: FollowingUser[]; targetUserId: string | null }> {
    const s = await session.launch()
    const { page } = s
    const users: FollowingUser[] = []
    const seen = new Set<string>()
    let targetUserId: string | null = null

    try {
      // 拦截 Following GraphQL 响应（页面加载 /following 时自己会请求）
      page.on('response', (res) => {
        const u = res.url()
        if (!u.includes('/graphql/') || !u.includes('Following')) return
        if (u.includes('FollowLatestTimeline')) return
        // targetUserId：新版 X 把 userId 放在请求 URL 的 variables.userId
        // （响应体 data.user.result 只有 __typename+timeline，无 rest_id；旧版才在响应体）
        try {
          const v = new URL(u).searchParams.get('variables')
          if (v) {
            const parsed = JSON.parse(v) as { userId?: string }
            if (parsed?.userId) targetUserId = parsed.userId
          }
        } catch {}
        res
          .json()
          .then((j: any) => {
            const tid = j?.data?.user?.result?.rest_id
            if (tid) targetUserId = tid
            const entries: Array<any> =
              j?.data?.user?.result?.timeline?.timeline?.instructions?.flatMap((i: { entries?: any[] }) => i.entries ?? []) ?? []
            for (const e of entries) {
              if (e.content?.entryType !== 'TimelineTimelineItem') continue
              const user = extractGqlUser(e.content?.itemContent?.user_results?.result)
              if (user && !seen.has(user.handle)) {
                seen.add(user.handle)
                users.push(user)
              }
            }
          })
          .catch(() => {})
      })

      await page.goto(`${base}/${handle}/following`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS })
      await page.waitForSelector('[data-testid="UserCell"]', { timeout: NAV_TIMEOUT_MS }).catch(() => {})

      // 等待 GraphQL 响应或首屏 DOM
      const t0 = Date.now()
      while (users.length === 0 && Date.now() - t0 < 8_000) {
        await page.waitForTimeout(500)
        const body = await page.evaluate(() => document.body?.innerText?.slice(0, 600) ?? '').catch(() => '')
        if (session.verify && (await session.verify(page).then((v: { valid: boolean }) => !v.valid).catch(() => false))) {
          throw new ApiError(ErrorCodes.AUTH_FAILED, '登录态失效：cookie 过期或无效，请更新登录凭据', 401)
        }
        if (!body) continue
      }

      // 滚动加载更多（响应拦截持续累积）
      let stallCount = 0
      for (let i = 0; i < (config.scrolls ?? MAX_SCROLLS) && users.length < limit; i++) {
        if (users.length >= limit) break
        const before = users.length
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
        await page.waitForTimeout(SCROLL_WAIT_MS)
        if (users.length === before) {
          stallCount++
          if (stallCount >= 2) break
        } else {
          stallCount = 0
        }
      }

      // DOM fallback（GraphQL 拦截失败时）：补漏
      if (users.length === 0) {
        const cells = await page.$$('[data-testid="UserCell"]')
        for (const cell of cells) {
          const info = (await cell.evaluate(extractCell).catch(() => null)) as { name: string; handle: string; bio: string; avatarUrl: string } | null
          if (!info) continue
          const key = info.handle || info.name
          if (seen.has(key)) continue
          seen.add(key)
          users.push({ ...info })
        }
      }

      if (users.length === 0) {
        throw new ApiError(ErrorCodes.SCRAPE_FAILED, '未能抓到关注列表（页面结构可能变化）', 502)
      }
      return { users: users.slice(0, limit), targetUserId }
    } finally {
      await s.close()
    }
  }

  /** 落库：target 用户 + 关注者资料 + 关注关系（增量），返回新增条数。 */
  function finishSync(handle: string, targetUserId: string | null, users: FollowingUser[]): number {
    if (targetUserId) store.upsertUser({ id: targetUserId, handle })
    const ids: string[] = []
    for (const u of users) {
      if (!u.userId) continue
      store.upsertUser({ id: u.userId, handle: u.handle, name: u.name, bio: u.bio, avatarUrl: u.avatarUrl })
      ids.push(u.userId)
    }
    if (!targetUserId || ids.length === 0) return 0
    return store.upsertFollowingRels(targetUserId, ids)
  }

  /** 读本地关注列表；未识别账号/未同步返回 null。 */
  function getLocalFollowing(limit: number): { handle: string; users: FollowingUser[]; syncedAt: number | null } | null {
    const handle = resolveHandleCached()
    if (!handle) return null
    const me = store.getUserByHandle(handle)
    if (!me) return null
    const rows = store.getFollowingUsers(me.id, limit)
    if (rows.length === 0) return null
    return {
      handle,
      users: rows.map((r) => ({ userId: r.id, handle: r.handle, name: r.name, bio: r.bio, avatarUrl: r.avatarUrl })),
      syncedAt: store.getFollowingSyncedAt(me.id),
    }
  }

  // ─── 端点 ──────────────────────────────────────────────────────────────

  api.get('/api/following', (c: any) => {
    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? config.limit) || config.limit, 1), 1000)
    const local = getLocalFollowing(limit)
    if (!local) {
      const handle = resolveHandleCached()
      return c.json(
        {
          ok: false,
          error: {
            code: handle ? ErrorCodes.NOT_SYNCED : ErrorCodes.NO_ME,
            message: handle ? '本地还没有关注列表，请先同步' : '尚未识别当前登录账号，请先同步一次关注列表',
          },
        },
        404,
      )
    }
    return c.json({ ok: true, data: local, source: 'database', elapsedMs: 0 })
  })

  api.post('/api/following/sync', async (c: any) => {
    const t0 = Date.now()
    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? config.limit) || config.limit, 1), 1000)
    try {
      const creds = (ctx as any).credential as { hasRequired?: () => boolean } | undefined
      if (creds?.hasRequired && !creds.hasRequired()) {
        throw new ApiError(ErrorCodes.NO_COOKIES, '需要 X 登录态：请先在认证设置粘贴你的 cookie', 401)
      }
      const handle = await resolveCurrentHandle()
      const { users, targetUserId } = await fetchFollowing(handle, limit)
      const added = finishSync(handle, targetUserId, users)
      return c.json({
        ok: true,
        data: { handle, users, added, syncedAt: Date.now(), source: 'following' },
        source: 'following',
        elapsedMs: Date.now() - t0,
      })
    } catch (e) {
      const { status, body } = errorResponse(e)
      return c.json(body, status as 400 | 401 | 404 | 429 | 500 | 502 | 504)
    }
  })
}