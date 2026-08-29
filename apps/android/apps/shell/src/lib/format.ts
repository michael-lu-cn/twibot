/**
 * 展示格式化工具（RN 版）：从 web 版 lib/format.ts 平移，纯函数无 DOM 依赖。
 */
import type { TweetLink } from './api-client'

/** 数字缩写：1234 → 1.2K */
export function fmtCount(n: number | null | undefined): string {
  if (n == null) return ''
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K'
  return String(n)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** X 时间格式：'Thu Aug 13 14:36:02 +0000 2026'（RFC 2822）。 */
const X_TIME_RE = /^[A-Za-z]{3} ([A-Za-z]{3}) (\d{1,2}) (\d{2}):(\d{2}):(\d{2}) ([+-]\d{4}) (\d{4})$/

/**
 * 解析推文时间 → 毫秒时间戳。优先 Date.parse（ISO），X 的 RFC 2822 格式
 * 手写解析（Hermes 的 Date.parse 不认该格式，会返回 NaN）。
 */
export function parseTweetTime(time: string): number {
  const m = X_TIME_RE.exec(time.trim())
  if (m) {
    const month = MONTHS.indexOf(m[1])
    if (month !== -1) {
      const day = Number(m[2])
      const hh = Number(m[3])
      const mm = Number(m[4])
      const ss = Number(m[5])
      const tzSign = m[6][0] === '-' ? -1 : 1
      const tzMin = tzSign * (Number(m[6].slice(1, 3)) * 60 + Number(m[6].slice(3, 5)))
      const year = Number(m[7])
      return Date.UTC(year, month, day, hh, mm, ss) - tzMin * 60_000
    }
  }
  return Date.parse(time)
}

/** ISO/RFC2822 时间 → 相对时间 x s/m/h/d */
export function fmtAgo(iso: string): string {
  const t = parseTweetTime(iso)
  if (!Number.isFinite(t)) return ''
  const s = Math.floor((Date.now() - t) / 1000)
  if (s < 60) return `${Math.max(s, 0)}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

/** 头像首字母 fallback。 */
export function initial(name: string, handle: string): string {
  const src = name || handle
  return (src[0] ?? '?').toUpperCase()
}

/** 链接展示文本：去掉协议前缀与尾部斜杠。 */
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '')
}

const URL_RE = /https?:\/\/[^\s<>()[\]'"]+/g

export type LinkSegment =
  | { type: 'text'; value: string }
  | { type: 'link'; url: string; expandedUrl: string }

function splitTextUrls(value: string): LinkSegment[] {
  const out: LinkSegment[] = []
  let pos = 0
  for (const m of value.matchAll(URL_RE)) {
    const url = m[0]
    if (m.index > pos) out.push({ type: 'text', value: value.slice(pos, m.index) })
    out.push({ type: 'link', url, expandedUrl: url })
    pos = m.index + url.length
  }
  if (pos < value.length) out.push({ type: 'text', value: value.slice(pos) })
  return out
}

/** 把正文切段用于可点击渲染：实体优先，未覆盖段内裸 URL 兜底。 */
export function splitLinks(text: string, links: TweetLink[] | undefined): LinkSegment[] {
  if (!links || links.length === 0) return splitTextUrls(text)
  const sorted = [...links].sort((a, b) => text.indexOf(a.url) - text.indexOf(b.url))
  const out: LinkSegment[] = []
  let pos = 0
  for (const l of sorted) {
    const idx = text.indexOf(l.url, pos)
    if (idx === -1) continue
    if (idx > pos) out.push({ type: 'text', value: text.slice(pos, idx) })
    out.push({ type: 'link', url: l.url, expandedUrl: l.expandedUrl })
    pos = idx + l.url.length
  }
  if (pos < text.length) out.push({ type: 'text', value: text.slice(pos) })
  return out.flatMap((seg) => (seg.type === 'link' ? [seg] : splitTextUrls(seg.value)))
}