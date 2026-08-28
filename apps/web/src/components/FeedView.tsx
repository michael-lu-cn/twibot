import { useEffect, useState } from "react"
import { RefreshCw } from "lucide-react"
import { api, isOk, ERROR_HINTS, type ApiResult, type Tweet } from "@/lib/api"
import { TweetCard } from "@/components/TweetCard"
import { Button } from "@/components/ui/button"

/** 推荐流主视图：本地读取 + 手动同步。 */
export function FeedView() {
  const [tweets, setTweets] = useState<Tweet[]>([])
  const [loaded, setLoaded] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [msg, setMsg] = useState<{ kind: "error" | "info"; text: string } | null>(null)

  const showErr = (r: ApiResult<unknown>) => {
    if (isOk(r)) return
    const hint = ERROR_HINTS[r.error.code] ?? r.error.message
    setMsg({ kind: "error", text: hint })
  }

  async function loadFeed() {
    const r = await api.feed(50)
    if (isOk(r)) {
      setTweets(r.data.tweets)
      setMsg(null)
    } else if (r.error.code !== "NOT_SYNCED") {
      showErr(r)
    }
    setLoaded(true)
  }

  useEffect(() => {
    void loadFeed()
  }, [])

  async function sync() {
    setSyncing(true)
    setMsg({ kind: "info", text: "正在从 X 同步推荐流…" })
    const r = await api.syncFeed(50)
    if (isOk(r)) {
      setMsg({ kind: "info", text: `同步完成：新增 ${r.data.added} 条` })
      await loadFeed()
    } else {
      showErr(r)
    }
    setSyncing(false)
  }

  return (
    <div className="min-w-0 flex-1 border-x border-border">
      {/* 顶栏 */}
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/80 px-4 py-3 backdrop-blur">
        <h1 className="text-xl font-bold">主页</h1>
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
                  <div className="h-3 w-40 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-full animate-pulse rounded bg-muted" />
                  <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        ) : tweets.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <p className="text-[15px] text-muted-foreground">还没有推荐流数据。</p>
            <p className="max-w-sm text-[13px] text-muted-foreground/70">
              点击右上角「同步」，从你的 X 首页抓取推荐推文（需要有效登录 cookie）。
            </p>
            <Button onClick={sync} disabled={syncing} className="mt-2 rounded-full">
              首次同步
            </Button>
          </div>
        ) : (
          <>
            {tweets.map((t) => (
              <TweetCard key={t.id || `${t.text.slice(0, 24)}-${t.time}`} tweet={t} />
            ))}
          </>
        )}
      </div>
    </div>
  )
}