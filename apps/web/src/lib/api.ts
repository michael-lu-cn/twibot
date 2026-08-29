/** API 客户端：统一 Ok/Err 信封 + 错误提示。 */

export interface Ok<T> {
  ok: true
  data: T
  source: string
  elapsedMs: number
}

export interface Err {
  ok: false
  error: { code: string; message: string }
}

export type ApiResult<T> = Ok<T> | Err

export function isOk<T>(r: ApiResult<T>): r is Ok<T> {
  return r.ok === true
}

export const ERROR_HINTS: Record<string, string> = {
  NO_COOKIES: "需要 X 登录态：请在左侧输入你的 cookie（或配置 TWITTER_COOKIES 环境变量）。",
  AUTH_FAILED: "cookie 已失效，请重新从浏览器复制并粘贴更新。",
  BAD_CREDENTIAL: "cookie 无法解析或缺少必需键（auth_token / ct0）。",
  RATE_LIMITED: "请求过于频繁，X 限流中，请稍等片刻再试。",
  SCRAPE_FAILED: "抓取失败（X 页面结构可能已变化），请重试。",
  NOT_SYNCED: "本地还没有数据，点击「同步」从 X 抓取。",
  NO_ME: "尚未识别当前登录账号：同步一次关注列表后即可自动识别。",
  NETWORK: "无法连接后端，请确认 API 服务已启动（127.0.0.1:12000）。",
}

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
  avatarUrl?: string
  links?: TweetLink[]
  metrics?: { replies: number; reposts: number; likes: number; views: number | null } | null
}

export interface CredentialStatus {
  configured: boolean
  keys: string[]
  source: string
}

export interface FollowingUser {
  userId?: string
  name: string
  handle: string
  bio: string
  avatarUrl: string
}

async function request<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, init)
    const body = (await res.json().catch(() => null)) as ApiResult<T> | null
    if (!body) {
      return { ok: false, error: { code: "NETWORK", message: `后端返回异常（HTTP ${res.status}）` } }
    }
    return body
  } catch {
    return { ok: false, error: { code: "NETWORK", message: "无法连接后端（127.0.0.1:12000）" } }
  }
}

export const api = {
  credentialStatus: () => request<CredentialStatus>("/api/credential/status"),

  saveCredential: (cookie: string) =>
    request<{ configured: boolean; keys: string[] }>("/api/credential", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cookie }),
    }),

  feed: (limit = 50) => request<{ tweets: Tweet[]; syncedAt: number | null }>(`/api/feed?limit=${limit}`),

  syncFeed: (limit = 50) =>
    request<{ added: number; tweets: Tweet[]; syncedAt: number }>(`/api/feed/sync?limit=${limit}`, {
      method: "POST",
    }),

  /** 书签：拉取本地全部（上限 5000），前端按月分组展示。 */
  bookmarks: (limit = 5000) =>
    request<{ tweets: Tweet[]; syncedAt: number | null }>(`/api/bookmarks?limit=${limit}`),

  /** 同步书签：一次拉取尽量完整（上限 2000），后台滚动到无新推文自动停。 */
  syncBookmarks: (limit = 2000) =>
    request<{ added: number; tweets: Tweet[]; syncedAt: number }>(`/api/bookmarks/sync?limit=${limit}`, {
      method: "POST",
    }),

  following: (limit = 200) =>
    request<{ handle: string; users: FollowingUser[]; syncedAt: number | null }>(`/api/following?limit=${limit}`),

  syncFollowing: (limit = 200) =>
    request<{ handle: string; users: FollowingUser[]; added: number; syncedAt: number }>(
      `/api/following/sync?limit=${limit}`,
      { method: "POST" },
    ),

  userProfile: (handle: string) => request<{ user: UserProfile | null; tweets: Tweet[] }>(`/api/users/${handle}`),

  syncUserTweets: (handle: string, limit = 50) =>
    request<{ added: number; tweets: Tweet[]; syncedAt: number }>(`/api/users/${handle}/tweets/sync?limit=${limit}`, {
      method: "POST",
    }),

  startBatchUserTweets: (perUser = 20) =>
    request<{ taskId: string }>(`/api/batch/user-tweets/sync?perUser=${perUser}`, { method: "POST" }),

  batchTask: (taskId: string) => request<BatchTask>(`/api/batch/user-tweets/task/${taskId}`),

  smartGroups: () => request<{ groups: SmartGroup[]; options: GroupOption[]; total: number; generatedAt: number }>("/api/groups/auto"),

  unfollow: (handle: string) =>
    request<{ unfollowed: boolean; handle: string }>(`/api/users/${handle}/unfollow`, { method: "POST" }),

  setGroupOverride: (userId: string, groupKey: string) =>
    request<{ userId: string; groupKey: string | null }>("/api/groups/override", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId, groupKey }),
    }),
}

export interface UserProfile {
  id: string
  handle: string
  name: string
  bio: string
  avatarUrl: string
}

export interface BatchTask {
  id: string
  status: "running" | "done" | "failed" | "canceled"
  total: number
  done: number
  added: number
  current?: string
  error?: string
  createdAt: number
  finishedAt?: number
}

export interface SmartGroupMember {
  userId: string
  handle: string
  name: string
  avatarUrl: string
  bio: string
  tweetCount: number
  recentSample: string
  matched: string[]
}

export interface SmartGroup {
  id: string
  name: string
  users: SmartGroupMember[]
}

export interface GroupOption {
  id: string
  name: string
}