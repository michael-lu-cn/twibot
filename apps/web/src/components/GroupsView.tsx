import { useEffect, useState } from "react"
import { ExternalLink, Tags, Users } from "lucide-react"
import { api, isOk, ERROR_HINTS, type GroupOption, type SmartGroup } from "@/lib/api"
import { imgProxy } from "@/lib/format"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { MemberActions } from "@/components/MemberActions"
import { cn } from "@/lib/utils"

/** 智能分组视图：按最近推文记录自动归类关注者（未分组也展示，可改分组/取关）。 */
export function GroupsView({ onOpenUser }: { onOpenUser: (handle: string) => void }) {
  const [groups, setGroups] = useState<SmartGroup[]>([])
  const [options, setOptions] = useState<GroupOption[]>([])
  const [active, setActive] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [msg, setMsg] = useState<{ kind: "error" | "info"; text: string } | null>(null)

  async function load() {
    const r = await api.smartGroups()
    if (isOk(r)) {
      setGroups(r.data.groups)
      setOptions(r.data.options)
      setMsg(null)
    } else {
      const hint = ERROR_HINTS[r.error.code] ?? r.error.message
      setMsg({ kind: "error", text: hint })
    }
    setLoaded(true)
  }

  useEffect(() => {
    void load()
  }, [])

  const activeGroup = groups[active]
  const other = groups.find((g) => g.id === "other")
  const total = groups.reduce((n, g) => n + g.users.length, 0)

  return (
    <div className="min-w-0 flex-1 border-x border-border">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/80 px-4 py-3 backdrop-blur">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold">
            <Tags className="size-5 text-sky-500" /> 智能分组
          </h1>
          <p className="text-[13px] text-muted-foreground">
            根据资料与最近推文自动归类 · {total} 位关注 · {groups.length} 组
            {other && other.users.length > 0 ? `（未分组 ${other.users.length} 位）` : ""}
          </p>
        </div>
      </header>

      {msg ? (
        <div className="bg-destructive/10 px-4 py-2 text-[13px] text-destructive">{msg.text}</div>
      ) : null}

      {/* 组导航 chips（含「未分组」） */}
      <div className="flex gap-2 overflow-x-auto border-b border-border px-4 py-2.5">
        {!loaded ? (
          <div className="h-7 w-48 animate-pulse rounded-full bg-muted" />
        ) : groups.length === 0 ? (
          <span className="text-[13px] text-muted-foreground">暂无分组结果（需先同步关注列表与推文）</span>
        ) : (
          groups.map((g, i) => (
            <button
              key={g.id}
              type="button"
              onClick={() => setActive(i)}
              className={cn(
                "shrink-0 rounded-full px-3.5 py-1.5 text-[13px] transition-colors",
                i === active ? "bg-primary text-primary-foreground" : "bg-accent/60 hover:bg-accent",
              )}
            >
              {g.name} · {g.users.length}
            </button>
          ))
        )}
      </div>

      {/* 组成员列表 */}
      <div>
        {!loaded ? (
          <div className="space-y-0">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex gap-3 border-b border-border px-4 py-3">
                <div className="size-10 shrink-0 animate-pulse rounded-full bg-muted" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-32 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-full animate-pulse rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        ) : !activeGroup ? null : (
          <>
            {activeGroup.users.map((u) => (
              <div
                key={u.userId ?? u.handle}
                role="button"
                tabIndex={0}
                onClick={() => onOpenUser(u.handle)}
                onKeyDown={(e) => e.key === "Enter" && onOpenUser(u.handle)}
                className="flex w-full cursor-pointer gap-3 border-b border-border px-4 py-3 text-left hover:bg-accent/40"
              >
                <Avatar className="size-10 shrink-0">
                  <AvatarImage src={imgProxy(u.avatarUrl)} alt={u.handle} />
                  <AvatarFallback>{(u.name || u.handle).slice(0, 1).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-1">
                    <p className="truncate text-[15px] font-bold leading-tight">{u.name}</p>
                    <p className="truncate text-[13px] text-muted-foreground">@{u.handle}</p>
                    {u.tweetCount > 0 ? (
                      <span className="shrink-0 text-[12px] text-muted-foreground/70">· {u.tweetCount} 条记录</span>
                    ) : null}
                  </div>
                  {u.bio ? <p className="mt-0.5 line-clamp-1 text-[13px] text-foreground/80">{u.bio}</p> : null}
                  {u.recentSample ? (
                    <p className="mt-0.5 line-clamp-1 text-[12px] text-muted-foreground/80">「{u.recentSample}」</p>
                  ) : null}
                  {u.matched.length > 0 ? (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {u.matched.map((m) => (
                        <span key={m} className="rounded bg-sky-500/10 px-1.5 py-0.5 text-[11px] text-sky-500">
                          {m}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <MemberActions
                    userId={u.userId}
                    handle={u.handle}
                    currentGroup={activeGroup.id === "other" ? undefined : activeGroup.id}
                    options={options}
                    onChanged={() => void load()}
                  />
                </div>
                {/* 在 X 打开原主页（不触发行内进入应用内主页） */}
                <a
                  href={`https://x.com/${u.handle}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`在 X 打开 @${u.handle}`}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                  className="shrink-0 rounded-full p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-sky-500"
                >
                  <ExternalLink className="size-4" />
                </a>
              </div>
            ))}
            <div className="flex items-center justify-center gap-1.5 px-4 py-4 text-[13px] text-muted-foreground/50">
              <Users className="size-4" /> {activeGroup.name} · 共 {activeGroup.users.length} 位
            </div>
          </>
        )}
      </div>
    </div>
  )
}