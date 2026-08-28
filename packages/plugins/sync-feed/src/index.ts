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

export interface TweetLink {
  /** 正文中的短链（t.co）。 */
  url: string
  /** 真实展开地址。 */
  expandedUrl: string
}

export interface Tweet {
  id: string
  url: string
  time: string
  text: string
  authorName: string
  authorHandle: string
  authorId?: string
  avatarUrl?: string
  links?: TweetLink[]
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
    entities?: { urls?: Array<{ url?: string; expanded_url?: string }> }
  }
  const views = (inner.views as { count?: string }) ?? {}

  // 转推：解包到原文
  const rt = legacy.retweeted_status_result?.result as
    | (Record<string, unknown> & { __typename?: string; legacy?: Record<string, unknown> })
    | undefined
  const rtInner = rt && rt.__typename !== 'Tweet' ? (rt.tweet as Record<string, unknown> | undefined) : rt
  const rtLegacy = rtInner?.legacy as
    | { full_text?: string; created_at?: string; entities?: { urls?: Array<{ url?: string; expanded_url?: string }> } }
    | undefined

  const text = (rtLegacy?.full_text ?? legacy.full_text ?? '').trim()
  const createdAt = rtLegacy?.created_at ?? legacy.created_at ?? ''
  const id = String(inner.rest_id ?? '')
  if (!id && !text) return null

  // 正文链接实体（t.co 短链 → 真实地址），供前端可点击渲染
  const links: TweetLink[] = (rtLegacy?.entities?.urls ?? legacy.entities?.urls ?? [])
    .map((u) => ({ url: u.url ?? '', expandedUrl: u.expanded_url ?? u.url ?? '' }))
    .filter((l): l is TweetLink => !!l.url)

  const userResult = (inner.core as { user_results?: { result?: Record<string, any> } } | undefined)?.user_results?.result
  const userCore = userResult?.core as { name?: string; screen_name?: string } | undefined
  const userLegacy = userResult?.legacy as { name?: string; screen_name?: string; profile_image_url_https?: string } | undefined
  const avatarUrl =
    ((userResult?.avatar as { image_url?: string } | undefined)?.image_url ?? userLegacy?.profile_image_url_https ?? '').replace(
      /_normal\.(jpg|jpeg|png|webp)$/,
      '_400x400.$1',
    )

  return {
    id,
    url: id ? `https://x.com/i/web/status/${id}` : '',
    time: createdAt,
    text,
    authorName: userCore?.name ?? userLegacy?.name ?? '',
    authorHandle: userCore?.screen_name ?? userLegacy?.screen_name ?? '',
    authorId: String(userResult?.rest_id ?? ''),
    avatarUrl,
    links,
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

/** 从 timeline instructions 收集推文（去重），写入 tweets 数组。 */
export function collectFromInstructions(
  instructions: Array<{ entries?: GraphqlTweetEntry[] }>,
  tweets: Tweet[],
  seenIds: Set<string>,
  seenTexts: Set<string>,
): void {
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
  /** 主页 URL（本地调试/mock 可覆盖；默认 {baseUrl}/home）。 */
  homeUrl?: string
  /** X 基址（本地调试/mock 可覆盖；默认 https://x.com）。 */
  baseUrl?: string
}

const NAV_TIMEOUT_MS = 30_000
const SCROLL_WAIT_MS = 1200

export function apply(ctx: Context, config: Config): void {
  const session = ctx.session as any
  const store = ctx.store as any
  const api = ctx.api as any
  const base = (config.baseUrl ?? 'https://x.com').replace(/\/$/, '')

  /**
   * 通用时间线抓取：开会话 → 按 match 拦截 GraphQL 响应 → collectFromInstructions →
   * 登录墙探测 → DOM fallback → 滚动翻页。返回去重排序后的推文。
   */
  async function fetchTimeline(
    targetUrl: string,
    opts: { match: (u: string) => boolean; extract: (j: any) => Array<{ entries?: GraphqlTweetEntry[] }>; label: string },
    limit: number,
  ): Promise<Tweet[]> {
    const s = await session.launch()
    const { page } = s
    const tweets: Tweet[] = []
    const seenIds = new Set<string>()
    const seenTexts = new Set<string>()

    try {
      page.on('response', (res) => {
        const u = res.url()
        if (!opts.match(u)) return
        res
          .json()
          .then((j: any) => collectFromInstructions(opts.extract(j), tweets, seenIds, seenTexts))
          .catch(() => {})
      })

      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS })

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
            tweets.push({
              id: info.id,
              url: info.id ? `https://x.com/i/web/status/${info.id}` : '',
              time: info.time,
              text: info.text,
              authorName: '',
              authorHandle: '',
              links: [],
              metrics: null,
            })
          }
        }
      }

      // 滚动加载更多（触发 timeline cursor 翻页）
      for (let i = 0; i < (config.scrolls ?? 5) && tweets.length < limit; i++) {
        const before = tweets.length
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
        await page.waitForTimeout(SCROLL_WAIT_MS)
        if (tweets.length === before && i > 0) break
      }

      if (tweets.length === 0) {
        throw new ApiError(ErrorCodes.SCRAPE_FAILED, `未能抓到${opts.label}（页面结构可能变化）`, 502)
      }

      tweets.sort((a, b) => cmpSnowflakeDesc(a.id, b.id))
      return tweets.slice(0, limit)
    } finally {
      await s.close()
    }
  }

  /** 推荐流：HomeTimeline（ForYou；不匹配 HomeLatestTimeline）。 */
  function fetchFeed(limit: number): Promise<Tweet[]> {
    return fetchTimeline(config.homeUrl ?? `${base}/home`, {
      match: (u) =>
        u.includes('/graphql/') && u.includes('HomeTimeline') && !u.includes('HomeLatestTimeline') && !u.includes('promoted'),
      extract: (j) => {
        // HomeTimeline 真实 envelope: data.home.home_timeline_urt.instructions
        // (兼容旧式 data.home.timeline.instructions)
        const home = j?.data?.home
        const urt = home?.home_timeline_urt
        return urt?.instructions ?? home?.timeline?.instructions ?? []
      },
      label: '推荐流',
    }, limit)
  }

  /** 某用户的时间线：拦截 UserOriginalsTimeline（旧名 UserTweets 兼容）。 */
  function fetchUserTweets(handle: string, limit: number): Promise<Tweet[]> {
    return fetchTimeline(`${base}/${handle}`, {
      match: (u) => u.includes('/graphql/') && (u.includes('UserOriginalsTimeline') || u.includes('UserTweets')),
      extract: (j) => {
        const result = j?.data?.user?.result
        return result?.timeline?.timeline?.instructions ?? result?.timeline?.instructions ?? []
      },
      label: `@${handle} 的推文`,
    }, limit)
  }

  /** 落库一批推文（作者 upsert + 推文 upsert），返回新增数。 */
  function persistTweets(tweets: Tweet[]): number {
    let added = 0
    for (const t of tweets) {
      if (t.authorId && t.authorHandle) {
        store.upsertUser({
          id: t.authorId,
          handle: t.authorHandle,
          name: t.authorName,
          ...(t.avatarUrl ? { avatarUrl: t.avatarUrl } : {}),
        })
      }
      const isNew = store.upsertTweet({
        id: t.id,
        userId: t.authorId ?? '',
        text: t.text,
        createdAt: t.time,
        url: t.url,
        replies: t.metrics?.replies ?? 0,
        reposts: t.metrics?.reposts ?? 0,
        likes: t.metrics?.likes ?? 0,
        views: t.metrics?.views ?? null,
        links: t.links ?? [],
      })
      if (isNew) added++
    }
    return added
  }

  // 端点
  api.post('/api/feed/sync', async (c: any) => {
    const t0 = Date.now()
    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? config.limit) || config.limit, 1), 50)
    try {
      const tweets = await fetchFeed(limit)
      persistTweets(tweets)
      const feedIds = tweets.map((t) => t.id).filter(Boolean)
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
    return c.json({ ok: true, data: { tweets: rows.map(rowTweet), syncedAt: store.getFeedSyncedAt() }, source: 'database', elapsedMs: 0 })
  })

  // ─── 用户主页：资料 + 推文 ────────────────────────────────────────────

  api.get('/api/users/:handle', (c: any) => {
    const handle = c.req.param('handle')
    const user = store.getUserByHandle(handle)
    const rows = user ? store.listUserTweets(user.id, 50) : []
    return c.json({ ok: true, data: { user, tweets: rows.map(rowTweet) }, source: 'database', elapsedMs: 0 })
  })

  api.post('/api/users/:handle/tweets/sync', async (c: any) => {
    const t0 = Date.now()
    const handle = c.req.param('handle')
    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? config.limit) || config.limit, 1), 50)
    try {
      const tweets = await fetchUserTweets(handle, limit)
      const added = persistTweets(tweets)
      return c.json({
        ok: true,
        data: { added, tweets: tweets.map(apiTweet), syncedAt: Date.now() },
        source: 'sync',
        elapsedMs: Date.now() - t0,
      })
    } catch (e) {
      const { status, body } = errorResponse(e)
      return c.json(body, status as 400 | 401 | 429 | 500 | 502 | 504)
    }
  })
}

/** 输出给前端的推文形状（来自解析结果）。 */
function apiTweet(t: Tweet) {
  return {
    id: t.id,
    url: t.url,
    time: t.time,
    text: t.text,
    authorName: t.authorName,
    authorHandle: t.authorHandle,
    avatarUrl: t.avatarUrl,
    links: t.links ?? [],
    metrics: t.metrics,
  }
}

/** 输出给前端的推文形状（来自 DB 行）。 */
function rowTweet(r: any) {
  return {
    id: r.tweetId,
    url: r.tweet?.url ?? '',
    time: r.tweet?.createdAt ?? '',
    text: r.tweet?.text ?? '',
    authorName: r.author?.name ?? '',
    authorHandle: r.author?.handle ?? '',
    avatarUrl: r.author?.avatarUrl ?? '',
    links: r.tweet?.links ?? [],
    metrics: r.tweet ? { replies: r.tweet.replies, reposts: r.tweet.reposts, likes: r.tweet.likes, views: r.tweet.views } : null,
  }
}