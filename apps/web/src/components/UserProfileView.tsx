import { useEffect, useState } from "react"
import { ArrowLeft, RefreshCw } from "lucide-react"
import { api, isOk, ERROR_HINTS, type ApiResult, type Tweet, type UserProfile } from "@/lib/api"
import { imgProxy } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { TweetCard } from "@/components/TweetCard"

/** 用户主页：资料卡 + 该用户推文（本地读取 + 手动同步）。 */
export function UserProfileView({
  handle,
  onBack,
  onOpenUser,
}: {
  handle: string
  onBack: () => void
  onOpenUser: (handle: string) => void
}) {
  const [user, setUser] = useState<UserProfile | null>(null)
  const [tweets, setTweets] = useState<Tweet[]>([])
  const [loaded, setLoaded] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [msg, setMsg] = useState<{ kind: "error" | "info"; text: string } | null>(null)

  const showErr = (r: ApiResult<unknown>) => {
    if (isOk(r)) return
    const hint = ERROR_HINTS[r.error.code] ?? r.error.message
    setMsg({ kind: "error", text: hint })
  }

  async function load() {
    const r = await api.userProfile(handle)
    if (isOk(r)) {
      setUser(r.data.user)
      setTweets(r.data.tweets)
      setMsg(null)
    } else {
      showErr(r)
    }
    setLoaded(true)
  }

  useEffect(() => {
    void load()
  }, [handle])

  async function sync() {
    setSyncing(true)
    setMsg({ kind: "info", text: `正在同步 @${handle} 的推文…` })
    const r = await api.syncUserTweets(handle, 50)
    if (isOk(r)) {
      setMsg({ kind: "info", text: `同步完成：新增 ${r.data.added} 条推文` })
      await load()
    } else {
      showErr(r)
    }
    setSyncing(false)
  }

  return (
    <div className="min-w-0 flex-1 border-x border-border">
      {/* 顶栏 */}
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background/80 px-4 py-3 backdrop-blur">
        <button
          type="button"
          onClick={onBack}
          className="flex size-9 shrink-0 items-center justify-center rounded-full hover:bg-accent/70"
          aria-label="返回"
        >
          <ArrowLeft className="size-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold leading-tight">{user?.name || `@${handle}`}</h1>
          <p className="truncate text-[13px] text-muted-foreground">@{handle} · {tweets.length} 条已同步</p>
        </div>
        <Button size="sm" onClick={sync} disabled={syncing} className="rounded-full">
          <RefreshCw className={syncing ? "animate-spin" : ""} />
          {syncing ? "同步中" : "同步推文"}
        </Button>
      </header>

      {msg ? (
        <div
          className={`px-4 py-2 text-[13px] ${msg.kind === "error" ? "bg-destructive/10 text-destructive" : "text-muted-foreground"}`}
        >
          {msg.text}
        </div>
      ) : null}

      {/* 资料卡 */}
      <div className="flex items-center gap-4 border-b border-border px-4 py-4">
        <Avatar size="lg" className="shrink-0">
          {user?.avatarUrl ? <AvatarImage src={imgProxy(user.avatarUrl)} alt={user.handle} /> : null}
          <AvatarFallback>{(user?.name || user?.handle || handle).slice(0, 1).toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="truncate text-lg font-bold leading-tight">{user?.name || "—"}</p>
          <p className="truncate text-[14px] text-muted-foreground">@{handle}</p>
          {user?.bio ? <p className="mt-1 line-clamp-2 text-[13px] text-foreground/80">{user.bio}</p> : null}
        </div>
      </div>

      {/* 推文列表 / 空态 / 加载态 */}
      <div>
        {!loaded ? (
          <div className="space-y-0">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex gap-3 border-b border-border px-4 py-3">
                <div className="size-10 shrink-0 animate-pulse rounded-full bg-muted" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-40 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-full animate-pulse rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        ) : tweets.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <p className="text-[15px] text-muted-foreground">还没有 @{handle} 的推文数据。</p>
            <p className="max-w-sm text-[13px] text-muted-foreground/70">
              点击右上角「同步推文」，从该用户的 X 主页抓取最近推文（会自动抓取作者资料）。
            </p>
            <Button onClick={sync} disabled={syncing} className="mt-2 rounded-full">
              同步推文
            </Button>
          </div>
        ) : (
          tweets.map((t) => <TweetCard key={t.id || `${t.text.slice(0, 24)}-${t.time}`} tweet={t} onOpenUser={onOpenUser} />)
        )}
      </div>
    </div>
  )
}