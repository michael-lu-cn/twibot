/** 极简 hash 路由：左侧导航/用户主页与 URL 一一对应，支持前进后退与直接访问。 */
import type { TabKey } from "@/components/Sidebar"

export interface Route {
  tab: TabKey
  /** 用户主页 handle（渲染时优先级最高，占据主列）。 */
  userHandle?: string
}

/** 从 location.hash 解析路由；未知/空路径回退到主页。 */
export function parseHash(hash = window.location.hash): Route {
  const raw = hash.replace(/^#\/?/, "")
  const [seg, ...rest] = raw.split("/")
  switch (seg) {
    case "following":
    case "groups":
    case "bookmarks":
    case "auth":
    case "settings":
      return { tab: seg }
    case "users": {
      const handle = rest[0] ? decodeURIComponent(rest[0]) : undefined
      return { tab: "home", userHandle: handle }
    }
    default:
      return { tab: "home" }
  }
}

/** 路由 → hash（如 "#/bookmarks"、"/#/users/foo"）。 */
export function routeHash(r: Route): string {
  if (r.userHandle) return `#/users/${encodeURIComponent(r.userHandle)}`
  return `#/${r.tab}`
}

/** 应用路由到 URL（相同则不重复写入，避免触发多余 hashchange）。 */
export function applyRoute(r: Route): void {
  const next = routeHash(r)
  if (window.location.hash !== next) window.location.hash = next
}