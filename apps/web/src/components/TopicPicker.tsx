import { useMemo, useState } from "react"
import { Plus, Search, X } from "lucide-react"
import type { TopicIndex } from "@/lib/topic-graph"
import { scoreTopics } from "@/lib/topic-search"
import { TopicHighlight } from "@/components/TopicHighlight"
import { cn } from "@/lib/utils"

/**
 * 「选择话题」弹层：搜索 + 列表 + 新建并附带。
 * 用于 inspector 的「添加父话题 / 添加子话题」——DAG 里一个话题可有多个父，
 * 因此两端都允许挂接已有话题，也允许就地新建。
 */
export function TopicPicker({
  index,
  title,
  excludeIds,
  busy,
  onPick,
  onCreate,
  onClose,
}: {
  index: TopicIndex
  title: string
  excludeIds: Set<string>
  busy: boolean
  onPick: (id: string) => void
  onCreate: (name: string) => void
  onClose: () => void
}) {
  const [q, setQ] = useState("")

  const nodes = useMemo(
    () =>
      [...index.byId.values()].map((t) => ({
        id: t.id,
        name: t.name,
        childCount: index.childCount.get(t.id) ?? 0,
      })),
    [index],
  )

  const results = useMemo(() => {
    const base = nodes.filter((n) => !excludeIds.has(n.id))
    const trimmed = q.trim()
    if (!trimmed) return base.slice(0, 200).map((n) => ({ ...n, ranges: [] as Array<[number, number]> }))
    return scoreTopics(base, trimmed, 200).map((h) => {
      const node = base.find((n) => n.id === h.id) as { id: string; name: string; childCount: number }
      return { ...node, ranges: h.ranges }
    })
  }, [nodes, q, excludeIds])

  const newName = q.trim()

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[70vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-[15px] font-bold">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-full p-1.5 hover:bg-accent" aria-label="关闭">
            <X className="size-4" />
          </button>
        </div>

        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索话题…"
            className="min-w-0 flex-1 bg-transparent py-1 text-[14px] outline-none placeholder:text-muted-foreground"
          />
        </div>

        {newName ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onCreate(newName)}
            className="flex items-center gap-2 border-b border-border px-4 py-2.5 text-left text-[14px] text-sky-500 hover:bg-accent/50 disabled:opacity-50"
          >
            <Plus className="size-4 shrink-0" />
            <span className="truncate">新建「{newName}」并添加</span>
          </button>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {results.length === 0 ? (
            <p className="px-4 py-6 text-center text-[13px] text-muted-foreground">
              {nodes.length === 0 ? "还没有其它话题，可在上方输入名称新建" : "没有匹配的话题"}
            </p>
          ) : (
            results.map((n) => (
              <button
                key={n.id}
                type="button"
                disabled={busy}
                onClick={() => onPick(n.id)}
                className={cn(
                  "flex w-full items-center justify-between gap-2 border-b border-border px-4 py-2.5 text-left text-[14px] hover:bg-accent/50 disabled:opacity-50",
                )}
              >
                <span className="truncate">
                  <TopicHighlight text={n.name} ranges={n.ranges} />
                </span>
                {n.childCount > 0 ? (
                  <span className="shrink-0 text-[12px] text-muted-foreground">{n.childCount}</span>
                ) : null}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
