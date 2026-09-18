import { Context } from '@deepseek-ai/cordis'
import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

// ─── position 时间轴（从旧项目 position.ts 平移，纯函数）─────────────────
//
// 策略：每个数据流（某人的关注列表 / 某人的推文 / 某推文的评论）维护一条
// 单调递增的时间轴，position 越大越新。
// - 首次抓取：最新条目锚定 FIRST_POSITION（100000），越往过去越小（递减）。
// - 增量抓取：批内已知条目之前（更新）→ 自「最大 + 批内条数」起递减（最新在最前）；
//   之后（更旧）→ 最小 -1 递减；
//   夹在中间（中断遗漏补抓）→ 相邻已知位置间挤压，空位不足触发整条流重编号（resolvePositions）。
//
// 铁律：`orderedKeys` 一律是「新 → 旧」，而读取端是 `ORDER BY position DESC`，
// 因此**任何分支分配 position 都必须随下标递减**（第一个元素拿最高位）。
// 曾因「已知条目之前」与「整批全新」两个分支误用递增（next++），导致前插块的
// 显示顺序被整体反转（一次同步前插 N 条 = 这 N 条倒序），已修正。

export const FIRST_POSITION = 100_000

/** 为一批新条目规划 position。known 为已存 key→position；返回新条目 key→position。 */
export function planPositions(orderedKeys: string[], known: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>()
  if (known.size === 0) {
    let pos = FIRST_POSITION
    for (const k of orderedKeys) out.set(k, pos--)
    return out
  }
  let firstKnown = -1
  let lastKnown = -1
  for (let i = 0; i < orderedKeys.length; i++) {
    if (known.has(orderedKeys[i])) {
      if (firstKnown === -1) firstKnown = i
      lastKnown = i
    }
  }
  let maxPos = -Infinity
  let minPos = Infinity
  for (const p of known.values()) {
    if (p > maxPos) maxPos = p
    if (p < minPos) minPos = p
  }
  if (firstKnown === -1) {
    // 整批都不在已知集合：默认这批比已知的全部更新，占用 maxPos 之上连续区间。
    // 自高到低分配，保证 DESC 读取时批内顺序与 orderedKeys（新→旧）一致。
    let pos = maxPos + orderedKeys.length
    for (const k of orderedKeys) out.set(k, pos--)
    return out
  }
  // 已知条目之前的块（更新）：同样自高到低——最高位给 orderedKeys[0]。
  let next = maxPos + firstKnown
  for (let i = 0; i < firstKnown; i++) out.set(orderedKeys[i], next--)
  let prev = minPos - 1
  for (let i = lastKnown + 1; i < orderedKeys.length; i++) out.set(orderedKeys[i], prev--)
  // 中间空隙：相邻已知之间挤压（首段由顶部逻辑处理，跳过）
  let segStart = -1
  let prevKnownPos = 0
  let sawFirstKnown = false
  for (let i = 0; i < orderedKeys.length; i++) {
    const isKnown = known.has(orderedKeys[i])
    if (isKnown) {
      const knownPos = known.get(orderedKeys[i])!
      if (sawFirstKnown && segStart !== -1) {
        let p = prevKnownPos - 1
        for (let g = segStart; g < i; g++) out.set(orderedKeys[g], p--)
      }
      sawFirstKnown = true
      segStart = -1
      prevKnownPos = knownPos
    } else if (segStart === -1) {
      segStart = i
    }
  }
  return out
}

export interface PositionPlan {
  /** 新条目 → position（正常路径，插入用） */
  planned: Map<string, number>
  /** 非空 = 退化重编号（整条流，含已存条目），需将全部行 UPDATE 为映射值 */
  renumber: Map<string, number> | null
}

/** 解析一条流的最终 position 分配（含退化重编号路径）。 */
export function resolvePositions(orderedKeys: string[], known: Map<string, number>): PositionPlan {
  const planned = planPositions(orderedKeys, known)
  if (known.size > 0) {
    const knownPos = new Set(known.values())
    // 已存本身有重复位置（历史脏数据）也要重编号修复
    if (knownPos.size !== known.size) return renumberAll(orderedKeys, known)
    for (const [, p] of planned) {
      if (knownPos.has(p)) return renumberAll(orderedKeys, known)
    }
  }
  return { planned, renumber: null }
}

/** 整条流重编号：批内（最新在前）+ 批外已存（按 position DESC，更旧）统一按 100000 起递减 */
function renumberAll(orderedKeys: string[], known: Map<string, number>): PositionPlan {
  const inBatch = new Set(orderedKeys)
  const tail = [...known.keys()]
    .filter((k) => !inBatch.has(k))
    .sort((a, b) => (known.get(b) ?? 0) - (known.get(a) ?? 0))
  const all = [...orderedKeys, ...tail]
  const renumber = new Map<string, number>()
  let pos = FIRST_POSITION
  for (const k of all) renumber.set(k, pos--)
  return { planned: new Map(), renumber }
}

// ─── 数据行类型 ──────────────────────────────────────────────────────────

export interface UserRow {
  id: string
  handle: string
  name: string
  bio: string
  avatarUrl: string
}

export interface TweetRow {
  id: string
  userId: string
  text: string
  createdAt: string
  url: string
  replies: number
  reposts: number
  likes: number
  views: number | null
}

export interface FeedLink {
  /** 正文中的短链（t.co）。 */
  url: string
  /** 真实展开地址。 */
  expandedUrl: string
}

export interface FeedItemRow {
  tweetId: string
  position: number
  fetchedAt: number
  /** LEFT JOIN tweets/users 补全 */
  author?: { id: string; handle: string; name: string; avatarUrl: string } | null
  tweet?: {
    text: string
    createdAt: string
    url: string
    replies: number
    reposts: number
    likes: number
    views: number | null
    /** 正文内链接（可点击渲染用）。 */
    links: FeedLink[]
  } | null
}

export interface StoreService {
  /** 幂等建表。 */
  init(): void
  upsertUser(u: { id: string; handle: string; name?: string; bio?: string; avatarUrl?: string }): void
  upsertTweet(t: {
    id: string
    userId: string
    text?: string
    createdAt?: string
    url?: string
    replies?: number
    reposts?: number
    likes?: number
    views?: number | null
    links?: FeedLink[]
  }): boolean
  /** 增量写入 feed 流（position 时间轴），返回新增条数。 */
  upsertFeedPlanned(orderedTweetIds: string[]): number
  /** feed 流列表（position DESC，JOIN 补全）。 */
  listFeed(limit: number): FeedItemRow[]
  /** feed 最后同步时间。 */
  getFeedSyncedAt(): number | null
  /** 按 handle 查用户（本地数据，无则 null）。 */
  getUserByHandle(handle: string): UserRow | null
  /** 关注关系按 userId 分组 upsert（position 时间轴），返回新增条数。 */
  upsertFollowingRels(userId: string, orderedFollowsIds: string[]): number
  /** 某人关注的 userId 列表（position DESC = 最新关注在前）。 */
  getFollowingIds(userId: string, limit: number): string[]
  /** 某人关注的完整用户列表（join users 补全资料，保持关注顺序）。 */
  getFollowingUsers(userId: string, limit: number): FollowingUserRow[]
  /** 关注关系最后一次同步时间。 */
  getFollowingSyncedAt(userId: string): number | null
  /** 移除一条关注关系（取关后本地同步）。 */
  removeFollowingRel(userId: string, followsId: string): void
  /** 某人的推文列表（created_at DESC，JOIN 补全作者）。 */
  listUserTweets(userId: string, limit: number): FeedItemRow[]
  /** 已有推文的 userId 集合（批量续跑跳过已抓用）。 */
  getUserIdsWithTweets(): string[]
  /** 手动分组覆盖（groupKey 为空=清除恢复自动）。 */
  setGroupOverride(userId: string, groupKey: string | null): void
  /** 全部手动分组覆盖：userId → groupKey。 */
  getGroupOverrides(): Map<string, string>
  /** 书签：新增（幂等），返回新增数。 */
  upsertBookmarks(orderedTweetIds: string[]): number
  /** 书签列表（fetched_at DESC，JOIN 补全推文/作者）。 */
  listBookmarks(limit: number): FeedItemRow[]
  /** 书签最后同步时间。 */
  getBookmarksSyncedAt(): number | null
  /** 键值读写（登录账号 handle 持久化等）。 */
  kvGet(key: string): string | null
  kvSet(key: string, value: string): void
}

export interface FollowingUserRow {
  id: string
  handle: string
  name: string
  bio: string
  avatarUrl: string
}

export const name = 'core-store'

export interface Config {
  /** SQLite 文件路径。 */
  file: string
}

export function apply(ctx: Context, config: Config): void {
  mkdirSync(dirname(config.file), { recursive: true })
  const sqlite = new Database(config.file)
  sqlite.pragma('journal_mode = WAL')

  const init = (): void => {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        handle TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        bio TEXT NOT NULL DEFAULT '',
        avatar_url TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS tweets (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT '',
        text TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT '',
        url TEXT NOT NULL DEFAULT '',
        replies INTEGER NOT NULL DEFAULT 0,
        reposts INTEGER NOT NULL DEFAULT 0,
        likes INTEGER NOT NULL DEFAULT 0,
        views INTEGER,
        links TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS tweets_user_idx ON tweets(user_id);
      -- 旧库迁移：补充 links 列（幂等）
      `)
    try {
      sqlite.exec(`ALTER TABLE tweets ADD COLUMN links TEXT NOT NULL DEFAULT ''`)
    } catch {} // 列已存在
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS feed (
        tweet_id TEXT PRIMARY KEY,
        position INTEGER NOT NULL DEFAULT 0,
        fetched_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS feed_position_idx ON feed(position DESC);
      CREATE TABLE IF NOT EXISTS app_kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL DEFAULT '',
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS following_rels (
        user_id TEXT NOT NULL,
        follows_id TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        fetched_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, follows_id)
      );
      CREATE TABLE IF NOT EXISTS user_group_overrides (
        user_id TEXT PRIMARY KEY,
        group_key TEXT NOT NULL DEFAULT '',
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS bookmarks (
        tweet_id TEXT PRIMARY KEY,
        fetched_at INTEGER NOT NULL
      );
    `)
  }

  const service: StoreService = {
    init,

    upsertUser(u) {
      sqlite
        .prepare(
          `INSERT INTO users (id, handle, name, bio, avatar_url) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             handle = excluded.handle,
             name = CASE WHEN excluded.name <> '' THEN excluded.name ELSE users.name END,
             bio = CASE WHEN excluded.bio <> '' THEN excluded.bio ELSE users.bio END,
             avatar_url = CASE WHEN excluded.avatar_url <> '' THEN excluded.avatar_url ELSE users.avatar_url END`,
        )
        .run(u.id, u.handle, u.name ?? '', u.bio ?? '', u.avatarUrl ?? '')
    },

    upsertTweet(t) {
      const existed = !!sqlite.prepare('SELECT 1 FROM tweets WHERE id = ?').get(t.id)
      const linksJson = JSON.stringify(t.links ?? [])
      sqlite
        .prepare(
          `INSERT INTO tweets (id, user_id, text, created_at, url, replies, reposts, likes, views, links)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             user_id = excluded.user_id,
             text = excluded.text,
             created_at = excluded.created_at,
             url = excluded.url,
             replies = excluded.replies,
             reposts = excluded.reposts,
             likes = excluded.likes,
             views = excluded.views,
             links = excluded.links`,
        )
        .run(
          t.id,
          t.userId,
          t.text ?? '',
          t.createdAt ?? '',
          t.url ?? '',
          t.replies ?? 0,
          t.reposts ?? 0,
          t.likes ?? 0,
          t.views ?? null,
          linksJson,
        )
      return !existed
    },

    upsertFeedPlanned(orderedTweetIds) {
      if (orderedTweetIds.length === 0) return 0
      const known = new Map<string, number>()
      for (const row of sqlite.prepare('SELECT tweet_id, position FROM feed').all() as Array<{ tweet_id: string; position: number }>) {
        known.set(row.tweet_id, row.position)
      }
      // planPositions 只为新条目返回位置（已存条目保持 position 不变）
      const planned = planPositions(orderedTweetIds, known)
      const insertOnly = sqlite.prepare('INSERT OR IGNORE INTO feed (tweet_id, position, fetched_at) VALUES (?, ?, ?)')
      let added = 0
      for (const [id, pos] of planned) {
        insertOnly.run(id, pos, Date.now())
        added++
      }
      return added
    },

    listFeed(limit) {
      const rows = sqlite
        .prepare(
          `SELECT f.tweet_id, f.position, f.fetched_at,
                  t.user_id, t.text, t.created_at, t.url, t.replies, t.reposts, t.likes, t.views, t.links,
                  u.handle, u.name, u.avatar_url
           FROM feed f
           LEFT JOIN tweets t ON t.id = f.tweet_id
           LEFT JOIN users u ON u.id = t.user_id
           ORDER BY f.position DESC
           LIMIT ?`,
        )
        .all(limit) as Array<Record<string, unknown>>
      return rows.map((r) => ({
        tweetId: String(r.tweet_id),
        position: Number(r.position),
        fetchedAt: Number(r.fetched_at),
        tweet: r.text === undefined
          ? null
          : {
              text: String(r.text),
              createdAt: String(r.created_at),
              url: String(r.url),
              replies: Number(r.replies),
              reposts: Number(r.reposts),
              likes: Number(r.likes),
              views: r.views === null ? null : Number(r.views),
              links: r.links ? (JSON.parse(String(r.links)) as FeedLink[]) : [],
            },
        author: r.user_id && r.handle
          ? { id: String(r.user_id), handle: String(r.handle), name: String(r.name ?? ''), avatarUrl: String(r.avatar_url ?? '') }
          : null,
      }))
    },

    getFeedSyncedAt() {
      const row = sqlite.prepare('SELECT MAX(fetched_at) AS t FROM feed').get() as { t: number | null }
      return row.t ?? null
    },

    getUserByHandle(handle) {
      const row = sqlite.prepare('SELECT id, handle, name, bio, avatar_url FROM users WHERE handle = ?').get(handle) as
        | { id: string; handle: string; name: string; bio: string; avatar_url: string }
        | undefined
      if (!row) return null
      return { id: row.id, handle: row.handle, name: row.name, bio: row.bio, avatarUrl: row.avatar_url }
    },

    upsertFollowingRels(userId, orderedIds) {
      if (orderedIds.length === 0) return 0
      const existing = sqlite.prepare('SELECT follows_id, position FROM following_rels WHERE user_id = ?').all(userId) as Array<{
        follows_id: string
        position: number
      }>
      const known = new Map(existing.map((r) => [r.follows_id, r.position]))
      const plan = resolvePositions(orderedIds, known)
      let added = 0
      if (plan.renumber) {
        // 退化路径：整条流重编号（已存 + 新条目统一 UPDATE/INSERT）
        const update = sqlite.prepare('UPDATE following_rels SET position = ? WHERE user_id = ? AND follows_id = ?')
        const insert = sqlite.prepare('INSERT OR IGNORE INTO following_rels (user_id, follows_id, position, fetched_at) VALUES (?, ?, ?, ?)')
        for (const [f, position] of plan.renumber) {
          const existed = update.run(position, userId, f).changes > 0
          if (!existed) {
            insert.run(userId, f, position, Date.now())
            added++
          }
        }
        return added
      }
      const insertOnly = sqlite.prepare('INSERT OR IGNORE INTO following_rels (user_id, follows_id, position, fetched_at) VALUES (?, ?, ?, ?)')
      for (const f of orderedIds) {
        if (known.has(f)) continue
        const position = plan.planned.get(f)
        if (position === undefined) continue
        insertOnly.run(userId, f, position, Date.now())
        added++
      }
      return added
    },

    getFollowingIds(userId, limit) {
      const rows = sqlite
        .prepare('SELECT follows_id FROM following_rels WHERE user_id = ? ORDER BY position DESC LIMIT ?')
        .all(userId, limit) as Array<{ follows_id: string }>
      return rows.map((r) => r.follows_id)
    },

    getFollowingUsers(userId, limit) {
      const ids = this.getFollowingIds(userId, limit)
      if (ids.length === 0) return []
      const placeholders = ids.map(() => '?').join(', ')
      const rows = sqlite
        .prepare(`SELECT id, handle, name, bio, avatar_url FROM users WHERE id IN (${placeholders})`)
        .all(...ids) as Array<{ id: string; handle: string; name: string; bio: string; avatar_url: string }>
      const byId = new Map(rows.map((r) => [r.id, r]))
      return ids
        .map((id) => byId.get(id))
        .filter((r): r is { id: string; handle: string; name: string; bio: string; avatar_url: string } => !!r)
        .map((r) => ({ id: r.id, handle: r.handle, name: r.name, bio: r.bio, avatarUrl: r.avatar_url }))
    },

    getFollowingSyncedAt(userId) {
      const row = sqlite
        .prepare('SELECT MAX(fetched_at) AS t FROM following_rels WHERE user_id = ?')
        .get(userId) as { t: number | null }
      return row.t ?? null
    },

    removeFollowingRel(userId, followsId) {
      sqlite.prepare('DELETE FROM following_rels WHERE user_id = ? AND follows_id = ?').run(userId, followsId)
    },

    setGroupOverride(userId, groupKey) {
      if (!groupKey) {
        sqlite.prepare('DELETE FROM user_group_overrides WHERE user_id = ?').run(userId)
        return
      }
      sqlite
        .prepare(
          `INSERT INTO user_group_overrides (user_id, group_key, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(user_id) DO UPDATE SET group_key = excluded.group_key, updated_at = excluded.updated_at`,
        )
        .run(userId, groupKey, Date.now())
    },

    getGroupOverrides() {
      const rows = sqlite.prepare('SELECT user_id, group_key FROM user_group_overrides').all() as Array<{
        user_id: string
        group_key: string
      }>
      return new Map(rows.map((r) => [r.user_id, r.group_key]))
    },

    upsertBookmarks(orderedTweetIds) {
      if (orderedTweetIds.length === 0) return 0
      const insertOnly = sqlite.prepare('INSERT OR IGNORE INTO bookmarks (tweet_id, fetched_at) VALUES (?, ?)')
      let added = 0
      for (const id of orderedTweetIds) {
        insertOnly.run(id, Date.now())
        added++
      }
      return added
    },

    listBookmarks(limit) {
      const rows = sqlite
        .prepare(
          `SELECT b.tweet_id, b.fetched_at,
                  t.user_id, t.text, t.created_at, t.url, t.replies, t.reposts, t.likes, t.views, t.links,
                  u.handle, u.name, u.avatar_url
           FROM bookmarks b
           LEFT JOIN tweets t ON t.id = b.tweet_id
           LEFT JOIN users u ON u.id = t.user_id
           ORDER BY b.fetched_at DESC
           LIMIT ?`,
        )
        .all(limit) as Array<Record<string, unknown>>
      return rows.map((r) => ({
        tweetId: String(r.tweet_id),
        position: 0,
        fetchedAt: Number(r.fetched_at),
        tweet: r.text === undefined
          ? null
          : {
              text: String(r.text),
              createdAt: String(r.created_at),
              url: String(r.url),
              replies: Number(r.replies),
              reposts: Number(r.reposts),
              likes: Number(r.likes),
              views: r.views === null ? null : Number(r.views),
              links: r.links ? (JSON.parse(String(r.links)) as FeedLink[]) : [],
            },
        author: r.user_id && r.handle
          ? { id: String(r.user_id), handle: String(r.handle), name: String(r.name ?? ''), avatarUrl: String(r.avatar_url ?? '') }
          : null,
      }))
    },

    getBookmarksSyncedAt() {
      const row = sqlite.prepare('SELECT MAX(fetched_at) AS t FROM bookmarks').get() as { t: number | null }
      return row.t ?? null
    },

    listUserTweets(userId, limit) {
      const rows = sqlite
        .prepare(
          `SELECT t.id AS tweet_id, t.user_id, t.text, t.created_at, t.url, t.replies, t.reposts, t.likes, t.views, t.links,
                  u.handle, u.name, u.avatar_url
           FROM tweets t
           LEFT JOIN users u ON u.id = t.user_id
           WHERE t.user_id = ?
           ORDER BY t.created_at DESC, t.id DESC
           LIMIT ?`,
        )
        .all(userId, limit) as Array<{
        tweet_id: string
        user_id: string
        text: string
        created_at: string
        url: string
        replies: number
        reposts: number
        likes: number
        views: number | null
        links: string
        handle: string | null
        name: string | null
        avatar_url: string | null
      }>
      return rows.map((r) => ({
        tweetId: String(r.tweet_id),
        position: 0,
        fetchedAt: 0,
        tweet: {
          text: String(r.text),
          createdAt: String(r.created_at),
          url: String(r.url),
          replies: Number(r.replies),
          reposts: Number(r.reposts),
          likes: Number(r.likes),
          views: r.views === null ? null : Number(r.views),
          links: r.links ? (JSON.parse(r.links) as FeedLink[]) : [],
        },
        author: r.user_id && r.handle
          ? { id: String(r.user_id), handle: String(r.handle), name: String(r.name ?? ''), avatarUrl: String(r.avatar_url ?? '') }
          : null,
      }))
    },

    kvGet(key) {
      const row = sqlite.prepare('SELECT value FROM app_kv WHERE key = ?').get(key) as { value: string } | undefined
      return row?.value ?? null
    },

    getUserIdsWithTweets() {
      const rows = sqlite.prepare("SELECT DISTINCT user_id FROM tweets WHERE user_id <> ''").all() as Array<{ user_id: string }>
      return rows.map((r) => r.user_id)
    },

    kvSet(key, value) {
      sqlite
        .prepare(
          `INSERT INTO app_kv (key, value, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        )
        .run(key, value, Date.now())
    },
  }

  init()
  ctx.provide('store', service)

  // 卸载时关闭数据库
  ctx.effect(() => {
    return () => {
      sqlite.close()
    }
  }, 'close-sqlite')
}