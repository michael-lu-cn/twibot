/**
 * twibot API 客户端（RN 版）：统一 Ok/Err 信封 + 错误提示。
 * 语义与 web 版 apps/web/src/lib/api.ts 严格一致，仅增加可配置 baseUrl。
 */

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
  NO_COOKIES: '需要 X 登录态：请在设置中粘贴 cookie（或配置 TWITTER_COOKIES 环境变量）。',
  AUTH_FAILED: 'cookie 已失效，请重新从浏览器复制并粘贴更新。',
  BAD_CREDENTIAL: 'cookie 无法解析或缺少必需键（auth_token / ct0）。',
  RATE_LIMITED: '请求过于频繁，X 限流中，请稍等片刻再试。',
  SCRAPE_FAILED: '抓取失败（X 页面结构可能已变化），请重试。',
  NOT_SYNCED: '本地还没有数据，点击「同步」从 X 抓取。',
  NO_ME: '尚未识别当前登录账号：同步一次关注列表后即可自动识别。',
  NETWORK: '无法连接后端，请确认 API 服务已启动并检查地址。',
}

export interface TweetLink {
  url: string
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

export interface UserProfile {
  id: string
  handle: string
  name: string
  bio: string
  avatarUrl: string
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

export interface BatchTask {
  id: string
  status: 'running' | 'done' | 'failed' | 'canceled'
  total: number
  done: number
  added: number
  current?: string
  error?: string
  createdAt: number
  finishedAt?: number
}

/** 按宿主地址创建客户端；形如 http://127.0.0.1:12000。 */
export function createApiClient(baseUrl: string) {
  const base = baseUrl.replace(/\/+$/, '')

  /** 单请求默认超时：真机上网络被冻结/隧道断掉时，宁可报错也不要无限等待。 */
  const REQUEST_TIMEOUT_MS = 8000
  /**
   * 同步类请求的超时：这类接口要真的拉起 X 页面翻页抓取（书签默认 30 轮滚动，
   * 每轮 1.2s，加上建会话与首屏等待），耗时以分钟计。用默认 8s 会在服务端
   * 还在抓的时候就把连接掐了 —— 界面报"连不上后端"，而服务端其实还在写库。
   */
  const SYNC_TIMEOUT_MS = 180_000

  async function request<T>(
    path: string,
    init?: RequestInit,
    opts?: { timeoutMs?: number },
  ): Promise<ApiResult<T>> {
    // 没有超时的 fetch 会让"请求挂住"变成永远空白的界面（诊断屏也不显示原因）；
    // 拿不到响应就按网络错误返回，调用方至少能落到可解释的状态。
    const timeoutMs = opts?.timeoutMs ?? REQUEST_TIMEOUT_MS
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(`${base}${path}`, { ...init, signal: controller.signal })
      const body = (await res.json().catch(() => null)) as ApiResult<T> | null
      if (!body) {
        return { ok: false, error: { code: 'NETWORK', message: `后端返回异常（HTTP ${res.status}）` } }
      }
      return body
    } catch {
      return { ok: false, error: { code: 'NETWORK', message: '无法连接后端（检查地址与网络）' } }
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    /** 头像等图片走后端代理（浏览器直连图床不通时同理）。 */
    imgProxyUrl: (url: string | undefined | null): string | undefined =>
      url ? `${base}/api/img-proxy?url=${encodeURIComponent(url)}` : undefined,

    credentialStatus: () => request<CredentialStatus>('/api/credential/status'),
    saveCredential: (cookie: string) =>
      request<{ configured: boolean; keys: string[] }>('/api/credential', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cookie }),
      }),

    feed: (limit = 50) => request<{ tweets: Tweet[]; syncedAt: number | null }>(`/api/feed?limit=${limit}`),
    syncFeed: (limit = 50) =>
      request<{ added: number; tweets: Tweet[]; syncedAt: number }>(
        `/api/feed/sync?limit=${limit}`,
        { method: 'POST' },
        { timeoutMs: SYNC_TIMEOUT_MS },
      ),

    bookmarks: (limit = 5000) =>
      request<{ tweets: Tweet[]; syncedAt: number | null }>(`/api/bookmarks?limit=${limit}`),
    syncBookmarks: (limit = 2000) =>
      request<{ added: number; tweets: Tweet[]; syncedAt: number }>(
        `/api/bookmarks/sync?limit=${limit}`,
        { method: 'POST' },
        { timeoutMs: SYNC_TIMEOUT_MS },
      ),

    following: (limit = 200) =>
      request<{ handle: string; users: FollowingUser[]; syncedAt: number | null }>(`/api/following?limit=${limit}`),
    syncFollowing: (limit = 200) =>
      request<{ handle: string; users: FollowingUser[]; added: number; syncedAt: number }>(
        `/api/following/sync?limit=${limit}`,
        { method: 'POST' },
        { timeoutMs: SYNC_TIMEOUT_MS },
      ),

    userProfile: (handle: string) =>
      request<{ user: UserProfile | null; tweets: Tweet[] }>(`/api/users/${handle}`),
    syncUserTweets: (handle: string, limit = 50) =>
      request<{ added: number; tweets: Tweet[]; syncedAt: number }>(
        `/api/users/${handle}/tweets/sync?limit=${limit}`,
        { method: 'POST' },
        { timeoutMs: SYNC_TIMEOUT_MS },
      ),
    unfollow: (handle: string) =>
      request<{ unfollowed: boolean; handle: string }>(`/api/users/${handle}/unfollow`, { method: 'POST' }),

    startBatchUserTweets: (perUser = 20) =>
      request<{ taskId: string }>(`/api/batch/user-tweets/sync?perUser=${perUser}`, { method: 'POST' }),
    batchTask: (taskId: string) => request<BatchTask>(`/api/batch/user-tweets/task/${taskId}`),

    smartGroups: () =>
      request<{ groups: SmartGroup[]; options: GroupOption[]; total: number; generatedAt: number }>('/api/groups/auto'),
    setGroupOverride: (userId: string, groupKey: string) =>
      request<{ userId: string; groupKey: string | null }>('/api/groups/override', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId, groupKey }),
      }),
  }
}

export type ApiClient = ReturnType<typeof createApiClient>