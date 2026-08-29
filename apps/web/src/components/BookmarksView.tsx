import { useEffect, useMemo, useState } from "react"
import { Bookmark, RefreshCw } from "lucide-react"
import { api, isOk, ERROR_HINTS, type ApiResult, type Tweet } from "@/lib/api"
import { TweetCard } from "@/components/TweetCard"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// ─── 月份分组（按推文创建时间）───────────────────────────────────────────

/** 推文时间 → "YYYY-MM"（无法解析返回 null）。 */
function monthKey(time: string): string | null {
  const ts = Date.parse(time)
  if (!Number.isFinite(ts)) return null
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}

function monthLabel(key: string): string {
  const [y, m] = key.split("-")
  return `${y}年${Number(m)}月`
}

interface MonthGroup {
  key: string
  label: string
  tweets: Tweet[]
}

/** 按创建时间倒序分月；无法解析时间的推文归入末尾「时间未知」。 */
function groupByMonth(tweets: Tweet[]): MonthGroup[] {
  const sorted = [...tweets].sort((a, b) => Date.parse(b.time) - Date.parse(a.time))
  const groups: MonthGroup[] = []
  const unknown: Tweet[] = []
  for (const t of sorted) {
    const key = monthKey(t.time)
    if (!key) {
      unknown.push(t)
      continue
    }
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.tweets.push(t)
    else groups.push({ key, label: monthLabel(key), tweets: [t] })
  }
  if (unknown.length > 0) groups.push({ key: "_unknown", label: "时间未知", tweets: unknown })
  return groups
}

/** 书签主视图：收藏的推文（本地全量读取 + 手动同步，按月分组展示）。 */
export function BookmarksView({ onOpenUser }: { onOpenUser: (handle: string) => void }) {
  const [tweets, setTweets] = useState<Tweet[]>([])
  const [loaded, setLoaded] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [navOpen, setNavOpen] = useState(false)
  const [msg, setMsg] = useState<{ kind: "error" | "info"; text: string } | null>(null)

  const groups = useMemo(() => groupByMonth(tweets), [tweets])

  const showErr = (r: ApiResult<unknown>) => {
    if (isOk(r)) return
    const hint = ERROR_HINTS[r.error.code] ?? r.error.message
    setMsg({ kind: "error", text: hint })
  }

  async function load() {
    const r = await api.bookmarks()
    if (isOk(r)) {
      setTweets(r.data.tweets)
      setMsg(null)
    } else if (r.error.code !== "NOT_SYNCED") {
      showErr(r)
    }
    setLoaded(true)
  }

  useEffect(() => {
    void load()
  }, [])

  async function sync() {
    setSyncing(true)
    setMsg({ kind: "info", text: "正在同步书签…" })
    const r = await api.syncBookmarks()
    if (isOk(r)) {
      setMsg({ kind: "info", text: `同步完成：新增 ${r.data.added} 条` })
      await load()
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
          <h1 className="text-xl font-bold">书签</h1>
          <p className="text-[13px] text-muted-foreground">
            收藏的推文{loaded && tweets.length > 0 ? ` · ${tweets.length} 条` : ""}
          </p>
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
            {Array.from({ length: 5 }).map((_, i) => (
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
            <Bookmark className="size-10 text-muted-foreground/50" />
            <p className="text-[15px] text-muted-foreground">还没有书签数据。</p>
            <p className="max-w-sm text-[13px] text-muted-foreground/70">
              点击右上角「同步」，从你的 X 账号抓取收藏的推文。
            </p>
            <Button onClick={sync} disabled={syncing} className="mt-2 rounded-full">
              首次同步
            </Button>
          </div>
        ) : (
          groups.map((g) => (
            <section key={g.key} id={`bm-${g.key}`} className="scroll-mt-14">
              {/* 月份分组头 */}
              <div className="flex items-baseline gap-2 border-b border-border bg-muted/40 px-4 py-2">
                <span className="text-[13px] font-bold text-foreground">{g.label}</span>
                <span className="text-[12px] text-muted-foreground">{g.tweets.length} 条</span>
              </div>
              {g.tweets.map((t) => (
                <TweetCard key={t.id || `${t.text.slice(0, 24)}-${t.time}`} tweet={t} onOpenUser={onOpenUser} />
              ))}
            </section>
          ))
        )}
      </div>

      {/* 右侧隐藏月份导航：一列细横杆（每根代表一个月），悬停展开按月目录栏；月份多时整列滚动 */}
      {tweets.length > 0 ? (
        <div className="fixed right-2 top-1/2 z-30 -translate-y-1/2">
          <div className="flex items-center" onMouseEnter={() => setNavOpen(true)} onMouseLeave={() => setNavOpen(false)}>
            {/* 月份目录面板（悬停展开） */}
            {navOpen ? (
              <div className="max-h-[60vh] w-44 overflow-y-auto rounded-xl border border-border bg-background/95 p-1.5 shadow-lg backdrop-blur">
                <p className="px-2 pb-1 pt-0.5 text-[12px] font-bold text-muted-foreground">按月导航</p>
                {groups.map((g) => (
                  <button
                    key={g.key}
                    type="button"
                    onClick={() => {
                      setNavOpen(false)
                      document.getElementById(`bm-${g.key}`)?.scrollIntoView({ behavior: "smooth", block: "start" })
                    }}
                    className="flex w-full items-baseline justify-between gap-2 rounded-md px-2 py-1 text-left text-[13px] transition-colors hover:bg-accent"
                  >
                    <span className="font-medium">{g.label}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">{g.tweets.length}</span>
                  </button>
                ))}
              </div>
            ) : null}
            {/* 横杆列：每根横杆 = 一个月，点击直达；超出高度可滚动 */}
            <div className="flex max-h-[68vh] w-7 shrink-0 flex-col items-center gap-1.5 overflow-y-auto py-1.5 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-foreground/20">
              {groups.map((g) => (
                <button
                  key={g.key}
                  type="button"
                  title={g.label}
                  aria-label={`跳转到${g.label}`}
                  onClick={() => {
                    setNavOpen(false)
                    document.getElementById(`bm-${g.key}`)?.scrollIntoView({ behavior: "smooth", block: "start" })
                  }}
                  className={cn(
                    "h-1.5 w-4 shrink-0 cursor-pointer rounded-full transition-all duration-150",
                    navOpen ? "bg-foreground/40 hover:bg-foreground/60" : "bg-muted hover:bg-foreground/50",
                  )}
                />
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}