/**
 * 月份分组（RN 版）：从 web BookmarksView 平移，纯函数可单测。
 */
import type { Tweet } from './api-client'
import { parseTweetTime } from './format'

/** 推文时间 → "YYYY-MM"（无法解析返回 null）。 */
export function monthKey(time: string): string | null {
  const ts = parseTweetTime(time)
  if (!Number.isFinite(ts)) return null
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function monthLabel(key: string): string {
  const [y, m] = key.split('-')
  return `${y}年${Number(m)}月`
}

export interface MonthGroup {
  key: string
  label: string
  tweets: Tweet[]
}

/** 按创建时间倒序分月；无法解析的归入末尾「时间未知」。 */
export function groupByMonth(tweets: Tweet[]): MonthGroup[] {
  const sorted = [...tweets].sort((a, b) => parseTweetTime(b.time) - parseTweetTime(a.time))
  const groups: MonthGroup[] = []
  const unknown: Tweet[] = []
  for (const t of sorted) {
    const key = monthKey(t.time)
    if (!key) {
      unknown.push(t)
      continue
    }
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.tweets.push(t)
    else groups.push({ key, label: monthLabel(key), tweets: [t] })
  }
  if (unknown.length > 0) groups.push({ key: '_unknown', label: '时间未知', tweets: unknown })
  return groups
}