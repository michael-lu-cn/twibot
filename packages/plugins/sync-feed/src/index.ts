import { Context } from '@deepseek-ai/cordis'
import type { Page } from 'playwright'

// ─── 统一业务错误（轻量版，M1 起共享到 packages/core）────────────────────

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

// ─── 推文解析（从旧项目 tweets.ts / page-scripts.mjs 平移）───────────────

export interface Tweet {
  id: string
  url: string
  time: string
  text: string
  authorName: string
  authorHandle: string
  authorId?: string
  metrics?: { replies: number; reposts: number; likes: number; views: number | null } | null
}

interface GraphqlTweetEntry {
  content?: {
    entryType?: string
    itemContent?: {
      tweet_results?: { result?: Record<string, unknown> }
      promotedMetadata?: unknown
    }
  }
}

/** 从 GraphQL 条目提取推文；广告（promotedMetadata）返回 null。 */
export function extractTweet(entry: GraphqlTweetEntry): Tweet | null {
  const item = entry.content?.itemContent
  if (!item) return null
  if (item.promotedMetadata) return null // 广告过滤
  const result = item.tweet_results?.result as (Record<string, unknown> & { __typename?: string }) | undefined
  if (!result) return null

  const inner = (result.__typename === 'TweetWithVisibilityResults' ? result.tweet : result) as
    | (Record<string, unknown> & { __typename?: string })
    | undefined
  if (!inner || !inner.legacy) return null

  const legacy = inner.legacy as {
    full_text?: string
    created_at?: string
    retweeted_status_result?: { result?: Record<string, unknown> }
    favorite_count?: number
    retweet_count?: number
    reply_count?: number
  }
  const views = (inner.views as { count?: string }) ?? {}

  // 转推：解包到原文
  const rt = legacy.retweeted_status_result?.result as
    | (Record<string, unknown> & { __typename?: string; legacy?: Record<string, unknown> })
    | undefined
  const rtInner = rt && rt.__typename !== 'Tweet' ? (rt.tweet as Record<string, unknown> | undefined) : rt
  const rtLegacy = rtInner?.legacy as { full_text?: string; created_at?: string } | undefined

  const text = (rtLegacy?.full_text ?? legacy.full_text ?? '').trim()
  const createdAt = rtLegacy?.created_at ?? legacy.created_at ?? ''
  const id = String(inner.rest_id ?? '')
  if (!id && !text) return null

  const userResult = (inner.core as { user_results?: { result?: Record<string, any> } } | undefined)?.user_results?.result
  const userCore = userResult?.core as { name?: string; screen_name?: string } | undefined
  const userLegacy = userResult?.legacy as { name?: string; screen_name?: string } | undefined

  return {
    id,
    url: id ? `https://x.com/i/web/status/${id}` : '',
    time: createdAt,
    text,
    authorName: userCore?.name ?? userLegacy?.name ?? '',
    authorHandle: userCore?.screen_name ?? userLegacy?.screen_name ?? '',
    authorId: String(userResult?.rest_id ?? ''),
    metrics: {
      replies: legacy.reply_count ?? 0,
      reposts: legacy.retweet_count ?? 0,
      likes: legacy.favorite_count ?? 0,
      views: views.count ? Number(views.count) : null,
    },
  }
}

/** DOM fallback：article → 最小推文（正文/时间/id）。 */
export function extractDomTweet(node: Element): { text: string; time: string; id: string } | null {
  // 页面内 evaluate 执行：函数体内不定义命名函数/箭头（esbuild keepNames 陷阱，旧项目铁律）
  const text = node.querySelector('[data-testid="tweetText"]')?.textContent?.trim() ?? ''
  const time = node.querySelector('a[href*="/status/"] time')?.getAttribute('datetime') ?? ''
  const href = node.querySelector('a[href*="/status/"]')?.getAttribute('href') ?? ''
  const id = href.match(/\/(\d+)$/)?.[1] ?? ''
  if (!text && !id) return null
  return { text, time, id }
}

/** 雪花 ID 降序（新→旧）；空 id 排最后。 */
export function cmpSnowflakeDesc(a: string, b: string): number {
  if (!a) return 1
  if (!b) return -1
  if (a.length !== b.length) return b.length - a.length
  return a > b ? -1 : a < b ? 1 : 0
}

// ─── 抓取服务 ────────────────────────────────────────────────────────────

export const name = 'sync-feed'
export const inject = ['session', 'store', 'api']

export interface Config {
  /** 单次同步条数上限。 */
  limit: number
  /** 滚动轮数。 */
  scrolls: number
  /** 主页 URL（本地调试/mock 可覆盖；默认 X 首页 ForYou）。 */
  homeUrl?: string
}

const NAV_TIMEOUT_MS = 30_000
const SCROLL_WAIT_MS = 1200

export function apply(ctx: Context, config: Config): void {
  const session = ctx.session as any
  const store = ctx.store as any
  const api = ctx.api as any

  /** 推荐流抓取：拦截 HomeTimeline + 滚动翻页。 */
  async function fetchFeed(limit: number): Promise<{ tweets: Tweet[]; profile: { id: string | null; handle: string | null } }> {
    const s = await session.launch()
    const { page } = s
    const tweets: Tweet[] = []
    const seenIds = new Set<string>()
    const seenTexts = new Set<string>()

    try {
      page.on('response', (res) => {
        const u = res.url()
        if (!u.includes('/graphql/') || !u.includes('HomeTimeline')) return
        if (u.includes('HomeLatestTimeline')) return
        if (u.includes('promoted')) return
        res
          .json()
          .then((j: any) => {
            // HomeTimeline 真实 envelope: data.home.home_timeline_urt.instructions
            // (兼容旧式 data.home.timeline.instructions)
            const home = j?.data?.home
            const urt = home?.home_timeline_urt
            const instructions: Array<{ entries?: GraphqlTweetEntry[] }> = urt?.instructions ?? home?.timeline?.instructions ?? []
            for (const instr of instructions) {
              for (const e of instr.entries ?? []) {
                const t = extractTweet(e as GraphqlTweetEntry)
                if (!t || !t.text) continue
                if (t.id && seenIds.has(t.id)) continue
                if (!t.id && seenTexts.has(t.text)) continue
                if (t.id) seenIds.add(t.id)
                else seenTexts.add(t.text)
                tweets.push(t)
              }
            }
          })
          .catch(() => {})
      })

      await page.goto(config.homeUrl ?? 'https://x.com/home', { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS })

      // 登录墙 / 首屏等待
      const t0 = Date.now()
      while (tweets.length === 0 && Date.now() - t0 < 45_000) {
        await page.waitForTimeout(500)
        const body = await page.evaluate(() => document.body?.innerText?.slice(0, 600) ?? '').catch(() => '')
        if (session.verify && (await session.verify(page).then((v: { valid: boolean }) => !v.valid).catch(() => false))) {
          throw new ApiError(ErrorCodes.AUTH_FAILED, '登录态失效：cookie 过期或无效，请更新登录凭据', 401)
        }
        if (!body) continue
      }

      // DOM fallback（拦截失败时）
      if (tweets.length === 0) {
        await page.waitForSelector('article[data-testid="tweet"]', { timeout: 10_000 }).catch(() => {})
        const domTweets = await page.$$('article[data-testid="tweet"]')
        for (const el of domTweets.slice(0, limit)) {
          const info = (await el.evaluate(extractDomTweet).catch(() => null)) as { text: string; time: string; id: string } | null
          if (info?.text && !tweets.some((t) => t.text === info.text)) {
            tweets.push({ id: info.id, url: info.id ? `https://x.com/i/web/status/${info.id}` : '', time: info.time, text: info.text, authorName: '', authorHandle: '', metrics: null })
          }
        }
      }

      // 滚动加载更多（触发 HomeTimeline cursor 翻页）
      for (let i = 0; i < (config.scrolls ?? 5) && tweets.length < limit; i++) {
        const before = tweets.length
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
        await page.waitForTimeout(SCROLL_WAIT_MS)
        if (tweets.length === before && i > 0) break
      }

      if (tweets.length === 0) {
        throw new ApiError(ErrorCodes.SCRAPE_FAILED, '未能抓到推荐流（页面结构可能变化）', 502)
      }

      tweets.sort((a, b) => cmpSnowflakeDesc(a.id, b.id))
      return { tweets: tweets.slice(0, limit), profile: { id: null, handle: null } }
    } finally {
      await s.close()
    }
  }

  // 端点
  api.post('/api/feed/sync', async (c: any) => {
    const t0 = Date.now()
    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? config.limit) || config.limit, 1), 50)
    try {
      const { tweets, profile } = await fetchFeed(limit)
      const feedIds: string[] = []
      for (const t of tweets) {
        if (t.authorId && t.authorHandle) {
          store.upsertUser({ id: t.authorId, handle: t.authorHandle, name: t.authorName })
        }
        store.upsertTweet({
          id: t.id,
          userId: t.authorId ?? profile.id ?? '',
          text: t.text,
          createdAt: t.time,
          url: t.url,
          replies: t.metrics?.replies ?? 0,
          reposts: t.metrics?.reposts ?? 0,
          likes: t.metrics?.likes ?? 0,
          views: t.metrics?.views ?? null,
        })
        if (t.id) feedIds.push(t.id)
      }
      const added = store.upsertFeedPlanned(feedIds)
      return c.json({ ok: true, data: { added, tweets: tweets.map(apiTweet), syncedAt: Date.now() }, source: 'sync', elapsedMs: Date.now() - t0 })
    } catch (e) {
      const { status, body } = errorResponse(e)
      return c.json(body, status as 400 | 401 | 429 | 500 | 502 | 504)
    }
  })

  api.get('/api/feed', (c: any) => {
    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 20) || 20, 1), 100)
    const rows = store.listFeed(limit)
    if (rows.length === 0) {
      return c.json({ ok: false, error: { code: ErrorCodes.NOT_SYNCED, message: '本地还没有推荐流数据，请先同步' } }, 404)
    }
    const tweets = rows.map((r: any) => ({
      id: r.tweetId,
      url: r.tweet?.url ?? '',
      time: r.tweet?.createdAt ?? '',
      text: r.tweet?.text ?? '',
      authorName: r.author?.name ?? '',
      authorHandle: r.author?.handle ?? '',
      avatarUrl: r.author?.avatarUrl ?? '',
      metrics: r.tweet ? { replies: r.tweet.replies, reposts: r.tweet.reposts, likes: r.tweet.likes, views: r.tweet.views } : null,
    }))
    return c.json({ ok: true, data: { tweets, syncedAt: store.getFeedSyncedAt() }, source: 'database', elapsedMs: 0 })
  })
}

/** 输出给前端的推文形状。 */
function apiTweet(t: Tweet) {
  return {
    id: t.id,
    url: t.url,
    time: t.time,
    text: t.text,
    authorName: t.authorName,
    authorHandle: t.authorHandle,
    metrics: t.metrics,
  }
}