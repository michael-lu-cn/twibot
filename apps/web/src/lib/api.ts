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
  TOPIC_NOT_FOUND: "话题不存在或已被删除（可能已被改动）。",
  TOPIC_CYCLE: "该操作会让话题关系形成环，已被阻止。",
  TOPIC_SELF_PARENT: "话题不能作为自己的父话题。",
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

  // ── 话题 DAG（关系由子话题持有；写操作回传全量图）──

  /** 全量图：Finder 与本地模糊搜索的唯一数据源。 */
  topics: () => request<TopicGraph>("/api/topics"),

  /** 单话题详情（含全部父/子与一条代表路径）。 */
  topic: (id: string) => request<TopicDetail>(`/api/topics/${encodeURIComponent(id)}`),

  /** 新建话题；可一次带上初始父集合。 */
  createTopic: (input: { name: string; description?: string; color?: string; parentIds?: string[] }) =>
    request<{ graph: TopicGraph; topic: TopicNode }>("/api/topics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),

  /** 局部更新（名称/描述/颜色）。 */
  updateTopic: (id: string, patch: { name?: string; description?: string; color?: string }) =>
    request<{ graph: TopicGraph; topic: TopicNode }>(`/api/topics/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }),

  /** 删除本话题及其边；子话题保留。 */
  deleteTopic: (id: string) =>
    request<{ graph: TopicGraph; deletedId: string }>(`/api/topics/${encodeURIComponent(id)}`, { method: "DELETE" }),

  /** 给子话题 childId 增加一个父话题。 */
  addTopicParent: (childId: string, parentId: string) =>
    request<{ graph: TopicGraph }>(`/api/topics/${encodeURIComponent(childId)}/parents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ parentId }),
    }),

  /** 原子替换子话题的父集合（含环校验，整批拒绝）。 */
  setTopicParents: (childId: string, parentIds: string[]) =>
    request<{ graph: TopicGraph }>(`/api/topics/${encodeURIComponent(childId)}/parents`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ parentIds }),
    }),

  /** 移除一条父边。 */
  removeTopicParent: (childId: string, parentId: string) =>
    request<{ graph: TopicGraph; removed: boolean }>(
      `/api/topics/${encodeURIComponent(childId)}/parents/${encodeURIComponent(parentId)}`,
      { method: "DELETE" },
    ),

  /** 服务端模糊搜索（web 主路径是本地搜索，此接口用于 API 完备性/多端）。 */
  searchTopics: (q: string, limit = 50) =>
    request<{ results: TopicSearchHit[]; total: number }>(
      `/api/topics/search?q=${encodeURIComponent(q)}&limit=${limit}`,
    ),
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

// ── 话题 DAG 契约（与 apps/api 的 core-topics 信封口径一致）──

export interface TopicNode {
  id: string
  name: string
  description: string
  color: string
  createdAt: number
  updatedAt: number
}

export interface TopicEdge {
  parentId: string
  childId: string
}

export interface TopicGraph {
  topics: TopicNode[]
  edges: TopicEdge[]
  /** 图版本（max updatedAt），预留条件请求。 */
  rev: number
}

export interface TopicDetail {
  topic: TopicNode
  parents: TopicNode[]
  children: TopicNode[]
  /** 一条 root → … → topic 的代表路径（多父时取最短）。 */
  path: string[]
}

export interface TopicSearchHit {
  topic: TopicNode
  score: number
  ranges: Array<[number, number]>
  path: string[]
}