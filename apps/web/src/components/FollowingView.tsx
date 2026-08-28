import { useEffect, useState } from "react"
import { RefreshCw, UserRound } from "lucide-react"
import { api, isOk, ERROR_HINTS, type ApiResult, type FollowingUser } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"

/** 关注列表主视图：我关注的账号（本地读取 + 手动同步）。 */
export function FollowingView() {
  const [users, setUsers] = useState<FollowingUser[]>([])
  const [handle, setHandle] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [msg, setMsg] = useState<{ kind: "error" | "info"; text: string } | null>(null)

  const showErr = (r: ApiResult<unknown>) => {
    if (isOk(r)) return
    const hint = ERROR_HINTS[r.error.code] ?? r.error.message
    setMsg({ kind: "error", text: hint })
  }

  async function loadFollowing() {
    const r = await api.following(200)
    if (isOk(r)) {
      setUsers(r.data.users)
      setHandle(r.data.handle)
      setMsg(null)
    } else if (r.error.code !== "NOT_SYNCED" && r.error.code !== "NO_ME") {
      showErr(r)
    }
    setLoaded(true)
  }

  useEffect(() => {
    void loadFollowing()
  }, [])

  async function sync() {
    setSyncing(true)
    setMsg({ kind: "info", text: "正在同步关注列表…" })
    const r = await api.syncFollowing(200)
    if (isOk(r)) {
      setHandle(r.data.handle)
      setMsg({ kind: "info", text: `同步完成：新增 ${r.data.added} 位关注` })
      await loadFollowing()
    } else {
      showErr(r)
    }
    setSyncing(false)
  }

  return (
    <div className="min-w-0 flex-1 border-x border-border">
      {/* 顶栏 */}
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/80 px-4 py-3 backdrop-blur">
        <div>
          <h1 className="text-xl font-bold">关注</h1>
          {handle ? (
            <p className="text-[13px] text-muted-foreground">@{handle} 关注的账号</p>
          ) : (
            <p className="text-[13px] text-muted-foreground">我关注的账号</p>
          )}
        </div>
        <Button size="sm" onClick={sync} disabled={syncing} className="rounded-full">
          <RefreshCw className={syncing ? "animate-spin" : ""} />
          {syncing ? "同步中" : "同步"}
        </Button>
      </header>

      {msg ? (
        <div
          className={`px-4 py-2 text-[13px] ${msg.kind === "error" ? "bg-destructive/10 text-destructive" : "text-muted-foreground"}`}
        >
          {msg.text}
        </div>
      ) : null}

      {/* 列表 / 空态 / 加载态 */}
      <div>
        {!loaded ? (
          <div className="space-y-0">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex gap-3 border-b border-border px-4 py-3">
                <div className="size-10 shrink-0 animate-pulse rounded-full bg-muted" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-28 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-40 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-56 animate-pulse rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        ) : users.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <UserRound className="size-10 text-muted-foreground/50" />
            <p className="text-[15px] text-muted-foreground">还没有关注列表数据。</p>
            <p className="max-w-sm text-[13px] text-muted-foreground/70">
              点击右上角「同步」，从你的 X 账号抓取关注列表（自动识别当前登录账号）。
            </p>
            <Button onClick={sync} disabled={syncing} className="mt-2 rounded-full">
              首次同步
            </Button>
          </div>
        ) : (
          <>
            {users.map((u) => (
              <div key={u.userId ?? u.handle} className="flex gap-3 border-b border-border px-4 py-3 hover:bg-accent/40">
                <Avatar className="size-10 shrink-0">
                  <AvatarImage src={u.avatarUrl || undefined} alt={u.handle} />
                  <AvatarFallback>{(u.name || u.handle).slice(0, 1).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-1">
                    <p className="truncate text-[15px] font-bold leading-tight">{u.name}</p>
                    <p className="truncate text-[13px] text-muted-foreground">@{u.handle}</p>
                  </div>
                  {u.bio ? <p className="mt-0.5 line-clamp-2 text-[13px] text-foreground/80">{u.bio}</p> : null}
                </div>
              </div>
            ))}
            <div className="px-4 py-6 text-center text-[13px] text-muted-foreground/60">
              共显示 {users.length} 位关注
            </div>
          </>
        )}
      </div>
    </div>
  )
}