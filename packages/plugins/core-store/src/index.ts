import { Context } from '@deepseek-ai/cordis'
import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

// ─── position 时间轴（从旧项目 position.ts 平移，纯函数）─────────────────

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
    let pos = maxPos + 1
    for (const k of orderedKeys) out.set(k, pos++)
    return out
  }
  let next = maxPos + 1
  for (let i = 0; i < firstKnown; i++) out.set(orderedKeys[i], next++)
  let prev = minPos - 1
  for (let i = lastKnown + 1; i < orderedKeys.length; i++) out.set(orderedKeys[i], prev--)
  return out
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

export interface FeedItemRow {
  tweetId: string
  position: number
  fetchedAt: number
  /** LEFT JOIN tweets/users 补全 */
  author?: { id: string; handle: string; name: string; avatarUrl: string } | null
  tweet?: { text: string; createdAt: string; url: string; replies: number; reposts: number; likes: number; views: number | null } | null
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
  }): boolean
  /** 增量写入 feed 流（position 时间轴），返回新增条数。 */
  upsertFeedPlanned(orderedTweetIds: string[]): number
  /** feed 流列表（position DESC，JOIN 补全）。 */
  listFeed(limit: number): FeedItemRow[]
  /** feed 最后同步时间。 */
  getFeedSyncedAt(): number | null
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
        views INTEGER
      );
      CREATE TABLE IF NOT EXISTS feed (
        tweet_id TEXT PRIMARY KEY,
        position INTEGER NOT NULL DEFAULT 0,
        fetched_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS feed_position_idx ON feed(position DESC);
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
      sqlite
        .prepare(
          `INSERT INTO tweets (id, user_id, text, created_at, url, replies, reposts, likes, views)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             user_id = excluded.user_id,
             text = excluded.text,
             created_at = excluded.created_at,
             url = excluded.url,
             replies = excluded.replies,
             reposts = excluded.reposts,
             likes = excluded.likes,
             views = excluded.views`,
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
                  t.user_id, t.text, t.created_at, t.url, t.replies, t.reposts, t.likes, t.views,
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