/** 展示格式化工具。 */

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