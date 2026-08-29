/**
 * twibot 路由（RN 版）：语义与 web 版 lib/router.ts 一致。
 * web 用 location.hash，RN 用深链 path 字符串（twibot://bookmarks → '/bookmarks'）。
 * 纯函数，可单测；App 侧负责把深链翻译成 path 再交给这里。
 */

export type TabKey = 'home' | 'following' | 'groups' | 'bookmarks' | 'auth'

export interface Route {
  tab: TabKey
  /** 用户主页 handle（渲染时优先级最高）。 */
  userHandle?: string
}

/** 'bookmarks' | 'users/foo' | '' → Route；未知/空回退主页。 */
export function parseRoutePath(path: string): Route {
  const raw = path.replace(/^\/+/, '')
  const [seg, ...rest] = raw.split('/')
  switch (seg) {
    case 'following':
    case 'groups':
    case 'bookmarks':
    case 'auth':
      return { tab: seg }
    case 'users': {
      const handle = rest[0] ? decodeURIComponent(rest[0]) : undefined
      return { tab: 'home', userHandle: handle }
    }
    default:
      return { tab: 'home' }
  }
}

/** Route → path（'/bookmarks'、'/users/foo'）。 */
export function routeToPath(r: Route): string {
  if (r.userHandle) return `/users/${encodeURIComponent(r.userHandle)}`
  return `/${r.tab}`
}

/** Route → 深链（twibot://bookmarks、twibot://users/foo）。 */
export function routeToDeepLink(r: Route, scheme = 'twibot'): string {
  return `${scheme}://${routeToPath(r).replace(/^\//, '')}`
}

/** 深链 → path；非本 scheme 返回 null。 */
export function deepLinkToPath(url: string, scheme = 'twibot'): string | null {
  if (!url.startsWith(`${scheme}://`)) return null
  return `/${url.slice(scheme.length + 3).replace(/\/+$/, '')}`
}