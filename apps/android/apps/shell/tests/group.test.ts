/**
 * M2: 月份分组纯函数（对齐 web BookmarksView 行为）。
 */
import { describe, expect, it } from 'vitest'
import { groupByMonth, monthKey, monthLabel } from '../src/lib/group'
import { parseTweetTime } from '../src/lib/format'
import type { Tweet } from '../src/lib/api-client'

const T = (id: string, time: string): Tweet =>
  ({ id, url: '', time, text: 'x', authorName: '', authorHandle: '', metrics: null }) as Tweet

describe('monthKey / monthLabel', () => {
  it('X RFC2822 时间解析', () => {
    expect(monthKey('Thu Aug 13 14:36:02 +0000 2026')).toBe('2026-08')
    expect(monthLabel('2026-08')).toBe('2026年8月')
  })
  it('无法解析 → null', () => {
    expect(monthKey('garbage')).toBeNull()
    expect(monthKey('')).toBeNull()
  })
})

describe('groupByMonth', () => {
  it('跨月降序分组 + 组内降序 + 未知时间兜底', () => {
    const groups = groupByMonth([
      T('1', 'Thu Aug 13 14:36:02 +0000 2026'),
      T('2', 'Mon Jul 06 09:00:00 +0000 2026'),
      T('3', 'Sun Jul 26 18:30:00 +0000 2026'),
      T('4', 'Sat Jun 01 00:00:00 +0000 2025'),
      T('5', 'garbage'),
      T('6', 'Thu Aug 13 08:00:00 +0000 2026'),
    ])
    expect(groups.map((g) => g.label)).toEqual(['2026年8月', '2026年7月', '2025年6月', '时间未知'])
    expect(groups[0].tweets.map((t) => t.id)).toEqual(['1', '6'])
    expect(groups[1].tweets.map((t) => t.id)).toEqual(['3', '2'])
    expect(groups[3].tweets.map((t) => t.id)).toEqual(['5'])
  })

  it('空数组 → 空分组', () => {
    expect(groupByMonth([])).toEqual([])
  })
})
describe('parseTweetTime（Hermes 兼容：RFC 2822 手写解析）', () => {
  it('X created_at 格式解析为正确 UTC 时间戳', () => {
    // Thu Aug 13 14:36:02 +0000 2026 = UTC
    expect(parseTweetTime('Thu Aug 13 14:36:02 +0000 2026')).toBe(Date.UTC(2026, 7, 13, 14, 36, 2))
    // 时区 -0700：本地 14:36 → UTC 21:36
    expect(parseTweetTime('Mon Jul 06 14:36:02 -0700 2026')).toBe(Date.UTC(2026, 6, 6, 21, 36, 2))
    // ISO 仍走 Date.parse
    expect(parseTweetTime('2026-08-13T14:36:02Z')).toBe(Date.parse('2026-08-13T14:36:02Z'))
    // 垃圾 → NaN
    expect(Number.isFinite(parseTweetTime('garbage'))).toBe(false)
  })

  it('monthKey 对 X 时间正确（Hermes 场景）', () => {
    expect(monthKey('2026-08-13T14:36:02Z')).toBe('2026-08')
  })
})
