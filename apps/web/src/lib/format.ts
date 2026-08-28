/** 展示格式化工具。 */
import type { TweetLink } from "./api"

/** 数字缩写：1234 → 1.2K */
export function fmtCount(n: number | null | undefined): string {
  if (n == null) return ""
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M"
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K"
  return String(n)
}

/** ISO 时间 → 相对时间 x s/m/h/d */
export function fmtAgo(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ""
  const s = Math.floor((Date.now() - t) / 1000)
  if (s < 60) return `${Math.max(s, 0)}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

/** 头像首字母 fallback。 */
export function initial(name: string, handle: string): string {
  const src = name || handle
  return (src[0] ?? "?").toUpperCase()
}

/** 图片走后端代理（浏览器直连 pbs.twimg.com 不通）：/api/img-proxy?url=… */
export function imgProxy(url: string | undefined | null): string | undefined {
  if (!url) return undefined
  return `/api/img-proxy?url=${encodeURIComponent(url)}`
}

/** 链接展示文本：去掉协议前缀与尾部斜杠（https://x.com/a/b → x.com/a/b）。 */
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "")
}

/** 把正文按链接实体切段：t.co 短链替换为真实地址的可点击片段。 */
export function splitLinks(
  text: string,
  links: TweetLink[] | undefined,
): Array<{ type: "text"; value: string } | { type: "link"; url: string; expandedUrl: string }> {
  if (!links || links.length === 0) return [{ type: "text", value: text }]
  const sorted = [...links].sort((a, b) => text.indexOf(a.url) - text.indexOf(b.url))
  const out: Array<{ type: "text"; value: string } | { type: "link"; url: string; expandedUrl: string }> = []
  let pos = 0
  for (const l of sorted) {
    const idx = text.indexOf(l.url, pos)
    if (idx === -1) continue
    if (idx > pos) out.push({ type: "text", value: text.slice(pos, idx) })
    out.push({ type: "link", url: l.url, expandedUrl: l.expandedUrl })
    pos = idx + l.url.length
  }
  if (pos < text.length) out.push({ type: "text", value: text.slice(pos) })
  return out
}