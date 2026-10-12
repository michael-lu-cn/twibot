import { useEffect, useMemo, useRef, useState } from "react"
import { Check, ChevronRight, Home, Network, Pencil, Plus, Search, Trash2, X } from "lucide-react"
import { api, isOk, ERROR_HINTS, type ApiResult, type TopicGraph, type TopicNode } from "@/lib/api"
import { buildIndex, normalizePath, pathToRoot, type TopicIndex } from "@/lib/topic-graph"
import { scoreTopics } from "@/lib/topic-search"
import { applyRoute } from "@/lib/router"
import { TopicPicker } from "@/components/TopicPicker"
import { TopicHighlight } from "@/components/TopicHighlight"
import { cn } from "@/lib/utils"

/**
 * 话题标签页：Finder 式列视图 + inspector + 模糊搜索。
 *
 * 数据是 `/api/topics` 的全量图，本地建邻接索引：
 * - 列视图用 `path: string[]`（root → … → 当前选中）表达浏览位置，
 *   一个子话题会出现在多个父分支下（DAG），点击即改写路径对应层级；
 * - 搜索是纯本地打分（`topic-search`），点结果按代表路径定位。
 * 所有写操作回传新图，前端 setGraph 即保持一致。
 */
export function TopicsView({ topicId }: { topicId?: string }) {
  const [graph, setGraph] = useState<TopicGraph | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [msg, setMsg] = useState<{ kind: "error" | "info"; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [path, setPath] = useState<string[]>([])
  const [query, setQuery] = useState("")
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState("")
  const [editing, setEditing] = useState<{ name: string; description: string } | null>(null)
  const [picker, setPicker] = useState<{ mode: "parent" | "child" } | null>(null)
  // 深链只应用一次：外部 topicId 变化时才重置路径，避免被后续 graph 变化反复覆盖
  const appliedTopicRef = useRef<string | undefined>(undefined)

  const index = useMemo(() => (graph ? buildIndex(graph) : null), [graph])
  const selectedId = path.length > 0 ? path[path.length - 1] : null
  const selected: TopicNode | null = selectedId && index ? (index.byId.get(selectedId) ?? null) : null

  const showErr = (r: { error: { code: string; message: string } }) =>
    setMsg({ kind: "error", text: ERROR_HINTS[r.error.code] ?? r.error.message })

  /** 同步路径到 URL（选择变化时刷新 hash，支持深链/前进后退）。 */
  function setPathWithHash(next: string[]) {
    setPath(next)
    const id = next[next.length - 1]
    if (id) {
      appliedTopicRef.current = id
      applyRoute({ tab: "topics", topicId: id })
    } else {
      appliedTopicRef.current = undefined
      applyRoute({ tab: "topics" })
    }
  }

  /** 统一写操作：成功则替换全图并执行 post；失败显示 ERROR_HINTS 且不改本地图。 */
  async function run<T extends { graph: TopicGraph }>(
    p: Promise<ApiResult<T>>,
    post?: (data: T, idx: TopicIndex) => void,
  ): Promise<boolean> {
    setBusy(true)
    try {
      const r = await p
      if (!isOk(r)) {
        showErr(r)
        return false
      }
      const nextIndex = buildIndex(r.data.graph)
      setGraph(r.data.graph)
      post?.(r.data, nextIndex)
      setMsg(null)
      return true
    } finally {
      setBusy(false)
    }
  }

  // 首次加载全量图
  useEffect(() => {
    let alive = true
    void (async () => {
      const r = await api.topics()
      if (!alive) return
      if (isOk(r)) setGraph(r.data)
      else showErr(r)
      setLoaded(true)
    })()
    return () => {
      alive = false
    }
  }, [])

  // 深链定位：#/topics/:id
  useEffect(() => {
    if (!index) return
    if (!topicId) {
      appliedTopicRef.current = undefined
      return
    }
    if (appliedTopicRef.current === topicId) return
    if (!index.byId.has(topicId)) return
    appliedTopicRef.current = topicId
    setPath(pathToRoot(index, topicId))
  }, [index, topicId])

  // 切换选中时退出编辑态
  useEffect(() => {
    setEditing(null)
  }, [selectedId])

  // 列集合：第 j 列 = path[j-1] 的子列表；若选中项有子话题，末尾追加一个预览列
  const columns = useMemo(() => {
    if (!index) return [] as Array<{ items: string[]; active: string | null }>
    const cols: Array<{ items: string[]; active: string | null }> = [
      { items: index.roots, active: path[0] ?? null },
    ]
    for (let i = 1; i < path.length; i++) {
      cols.push({ items: index.childrenOf.get(path[i - 1]) ?? [], active: path[i] })
    }
    const last = path[path.length - 1]
    const children = last ? (index.childrenOf.get(last) ?? []) : []
    if (last && children.length > 0) cols.push({ items: children, active: null })
    return cols
  }, [index, path])

  // 本地模糊搜索结果（含代表路径用于消歧）
  const results = useMemo(() => {
    if (!index || !query.trim()) return []
    const nodes = [...index.byId.values()].map((t) => ({
      id: t.id,
      name: t.name,
      childCount: index.childCount.get(t.id) ?? 0,
    }))
    return scoreTopics(nodes, query, 50).flatMap((h) => {
      const topic = index.byId.get(h.id)
      if (!topic) return []
      return [{ topic, score: h.score, ranges: h.ranges, path: pathToRoot(index, h.id) }]
    })
  }, [index, query])

  function onColumnClick(colIndex: number, id: string) {
    const next = colIndex === 0 ? [id] : [...path.slice(0, colIndex), id]
    setPathWithHash(next)
  }

  async function submitCreate() {
    const name = newName.trim()
    if (!name || !index) return
    const parentId = selectedId
    const done = await run(
      api.createTopic(parentId ? { name, parentIds: [parentId] } : { name }),
      (data, idx) => {
        setPathWithHash(parentId ? normalizePath(idx, [...path, data.topic.id]) : [data.topic.id])
      },
    )
    if (done) {
      setNewName("")
      setCreating(false)
    }
  }

  async function saveEdit() {
    if (!selectedId || !editing) return
    const name = editing.name.trim()
    if (!name) {
      setMsg({ kind: "error", text: "名称不能为空" })
      return
    }
    const done = await run(api.updateTopic(selectedId, { name, description: editing.description }))
    if (done) setEditing(null)
  }

  async function removeTopic(id: string, name: string) {
    if (!window.confirm(`删除话题「${name}」？它的子话题会保留，只解除关联。`)) return
    await run(api.deleteTopic(id), (_data, idx) => {
      setPathWithHash(normalizePath(idx, path.filter((x) => x !== id)))
    })
  }

  async function pickExisting(id: string) {
    if (!picker || !selectedId) return
    if (picker.mode === "parent") {
      await run(api.addTopicParent(selectedId, id))
    } else {
      await run(api.addTopicParent(id, selectedId), (_data, idx) => {
        setPathWithHash(normalizePath(idx, [...path, id]))
      })
    }
    setPicker(null)
  }

  async function createInPicker(name: string) {
    if (!picker || !selectedId) return
    if (picker.mode === "child") {
      const done = await run(api.createTopic({ name, parentIds: [selectedId] }), (data, idx) => {
        setPathWithHash(normalizePath(idx, [...path, data.topic.id]))
      })
      if (done) setPicker(null)
      return
    }
    // mode === 'parent'：先建节点，再把它挂为当前话题的父（新节点无后代，不会成环）
    setBusy(true)
    try {
      const created = await api.createTopic({ name })
      if (!isOk(created)) {
        showErr(created)
        return
      }
      await run(api.addTopicParent(selectedId, created.data.topic.id))
      setPicker(null)
    } finally {
      setBusy(false)
    }
  }

  const total = graph?.topics.length ?? 0
  const selectedChildren = selectedId && index ? (index.childrenOf.get(selectedId) ?? []) : []
  const selectedParents = selectedId && index ? (index.parentsOf.get(selectedId) ?? []) : []

  return (
    <div className="flex h-screen min-w-0 flex-1 border-x border-border">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* 顶栏：标题 + 搜索 + 新建 */}
        <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-4 py-3">
          <h1 className="flex items-center gap-2 text-xl font-bold">
            <Network className="size-5 text-sky-500" /> 话题
          </h1>
          <span className="text-[13px] text-muted-foreground">{total} 个</span>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                // 回到根目录：清空选中与搜索，这样「新建」就是新建根话题
                setPathWithHash([])
                setQuery("")
              }}
              title="回到根目录（不选中任何话题）"
              aria-label="回到根目录"
              className={cn(
                "flex items-center gap-1 rounded-full px-3 py-1.5 text-[13px] transition-colors hover:bg-accent",
                path.length === 0 ? "text-sky-500" : "text-muted-foreground",
              )}
            >
              <Home className="size-4" />
            </button>
            <div className="flex items-center gap-2 rounded-full bg-accent/50 px-3 py-1.5">
              <Search className="size-4 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="模糊搜索…"
                className="w-40 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground sm:w-56"
              />
              {query ? (
                <button type="button" onClick={() => setQuery("")} aria-label="清空搜索" className="text-muted-foreground hover:text-foreground">
                  <X className="size-3.5" />
                </button>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => setCreating((v) => !v)}
              className="flex items-center gap-1 rounded-full bg-primary px-3.5 py-1.5 text-[13px] font-medium text-primary-foreground hover:opacity-90"
            >
              <Plus className="size-4" /> 新建
            </button>
          </div>
        </header>

        {/* 新建输入行：有选中项时作为其子话题，否则建根 */}
        {creating ? (
          <div className="flex shrink-0 items-center gap-2 border-b border-border bg-accent/20 px-4 py-2">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submitCreate()
                if (e.key === "Escape") setCreating(false)
              }}
              placeholder={selected ? `在「${selected.name}」下新建子话题…` : "新建根话题…"}
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-[14px] outline-none focus:border-sky-500"
            />
            <button
              type="button"
              disabled={busy || !newName.trim()}
              onClick={() => void submitCreate()}
              className="rounded-md bg-primary px-3 py-1.5 text-[13px] text-primary-foreground disabled:opacity-50"
            >
              创建
            </button>
            <button type="button" onClick={() => setCreating(false)} className="rounded-md px-2 py-1.5 text-[13px] hover:bg-accent">
              取消
            </button>
          </div>
        ) : null}

        {msg ? <div className="shrink-0 bg-destructive/10 px-4 py-2 text-[13px] text-destructive">{msg.text}</div> : null}

        {/* 主体：搜索结果 或 Finder 列视图 */}
        {!loaded || !index ? (
          <div className="flex-1 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="mb-2 h-8 animate-pulse rounded bg-muted" />
            ))}
          </div>
        ) : query.trim() ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            {results.length === 0 ? (
              <p className="px-4 py-8 text-center text-[13px] text-muted-foreground">没有匹配的话题</p>
            ) : (
              results.map((r) => (
                <button
                  key={r.topic.id}
                  type="button"
                  onClick={() => {
                    setPathWithHash(r.path)
                    setQuery("")
                  }}
                  className="flex w-full flex-col items-start gap-0.5 border-b border-border px-4 py-2.5 text-left hover:bg-accent/40"
                >
                  <span className="text-[14px]">
                    <TopicHighlight text={r.topic.name} ranges={r.ranges} />
                  </span>
                  {r.path.length > 1 ? (
                    <span className="text-[12px] text-muted-foreground">
                      {r.path
                        .map((id) => index.byId.get(id)?.name ?? id)
                        .slice(0, -1)
                        .join(" › ")}
                    </span>
                  ) : null}
                </button>
              ))
            )}
          </div>
        ) : index.roots.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <Network className="size-8 text-muted-foreground/50" />
            <p className="text-[14px] text-muted-foreground">还没有任何话题</p>
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="rounded-full bg-primary px-4 py-1.5 text-[13px] text-primary-foreground"
            >
              创建第一个话题
            </button>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 overflow-x-auto">
            {columns.map((col, j) => (
              <div key={j} className="flex w-[220px] shrink-0 flex-col overflow-y-auto border-r border-border">
                {col.items.length === 0 ? (
                  <p className="px-3 py-3 text-[13px] text-muted-foreground/60">（无子话题）</p>
                ) : (
                  col.items.map((id) => {
                    const t = index.byId.get(id)
                    if (!t) return null
                    const hasChildren = (index.childrenOf.get(id)?.length ?? 0) > 0
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => onColumnClick(j, id)}
                        className={cn(
                          "flex items-center justify-between gap-2 px-3 py-2 text-left text-[14px] hover:bg-accent/50",
                          col.active === id ? "bg-accent font-semibold" : "",
                        )}
                      >
                        <span className="truncate">{t.name}</span>
                        {hasChildren ? <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" /> : null}
                      </button>
                    )
                  })
                )}
              </div>
            ))}
          </div>
        )}

        {/* 面包屑 */}
        {path.length > 0 && index ? (
          <div className="flex shrink-0 flex-wrap items-center gap-1 border-t border-border px-4 py-2 text-[13px] text-muted-foreground">
            {path.map((id, i) => (
              <span key={id} className="flex items-center gap-1">
                {i > 0 ? <ChevronRight className="size-3.5" /> : null}
                <button
                  type="button"
                  onClick={() => setPathWithHash(path.slice(0, i + 1))}
                  className={cn("hover:text-foreground hover:underline", i === path.length - 1 && "font-medium text-foreground")}
                >
                  {index.byId.get(id)?.name ?? id}
                </button>
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {/* Inspector */}
      <aside className="w-[300px] shrink-0 overflow-y-auto border-l border-border p-4">
        {!selected || !index ? (
          <p className="mt-6 text-center text-[13px] text-muted-foreground">
            从左侧逐级选择话题，或在上方搜索定位。
            <br />
            同一个话题可以出现在多个父话题下。
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {editing ? (
              <div className="flex flex-col gap-2">
                <input
                  autoFocus
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  className="rounded-md border border-border bg-background px-2.5 py-1.5 text-[14px] outline-none focus:border-sky-500"
                />
                <textarea
                  value={editing.description}
                  onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                  placeholder="描述（可选）"
                  rows={2}
                  className="resize-none rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] outline-none focus:border-sky-500"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void saveEdit()}
                    className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-[13px] text-primary-foreground disabled:opacity-50"
                  >
                    <Check className="size-3.5" /> 保存
                  </button>
                  <button type="button" onClick={() => setEditing(null)} className="rounded-md px-3 py-1.5 text-[13px] hover:bg-accent">
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <div className="flex items-start justify-between gap-2">
                  <h2 className="break-words text-[17px] font-bold">{selected.name}</h2>
                  <button
                    type="button"
                    onClick={() => setEditing({ name: selected.name, description: selected.description })}
                    className="shrink-0 rounded-full p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    aria-label="重命名"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                </div>
                {selected.description ? (
                  <p className="mt-1 whitespace-pre-wrap text-[13px] text-muted-foreground">{selected.description}</p>
                ) : null}
              </div>
            )}

            {/* 父话题（多父可见性） */}
            <section>
              <div className="mb-1.5 flex items-center justify-between">
                <h3 className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
                  父话题 · {selectedParents.length}
                </h3>
                <button
                  type="button"
                  onClick={() => setPicker({ mode: "parent" })}
                  className="rounded-full px-2 py-0.5 text-[12px] text-sky-500 hover:bg-accent"
                >
                  + 添加
                </button>
              </div>
              {selectedParents.length === 0 ? (
                <p className="text-[13px] text-muted-foreground/60">根话题（无上级）</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {selectedParents.map((pid) => {
                    const p = index.byId.get(pid)
                    if (!p) return null
                    return (
                      <span key={pid} className="inline-flex items-center gap-1 rounded-full bg-accent/60 py-0.5 pl-2.5 pr-1 text-[13px]">
                        <button
                          type="button"
                          onClick={() => setPathWithHash(pathToRoot(index, pid))}
                          className="max-w-[160px] truncate hover:underline"
                        >
                          {p.name}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          aria-label={`移除父话题 ${p.name}`}
                          onClick={() =>
                            void run(api.removeTopicParent(selected.id, pid), (_data, idx) => {
                              setPathWithHash(normalizePath(idx, path))
                            })
                          }
                          className="rounded-full p-0.5 text-muted-foreground hover:bg-background hover:text-destructive disabled:opacity-50"
                        >
                          <X className="size-3" />
                        </button>
                      </span>
                    )
                  })}
                </div>
              )}
            </section>

            {/* 子话题 */}
            <section>
              <div className="mb-1.5 flex items-center justify-between">
                <h3 className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
                  子话题 · {selectedChildren.length}
                </h3>
                <button
                  type="button"
                  onClick={() => setPicker({ mode: "child" })}
                  className="rounded-full px-2 py-0.5 text-[12px] text-sky-500 hover:bg-accent"
                >
                  + 添加
                </button>
              </div>
              {selectedChildren.length === 0 ? (
                <p className="text-[13px] text-muted-foreground/60">无下级话题</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {selectedChildren.map((cid) => {
                    const c = index.byId.get(cid)
                    if (!c) return null
                    return (
                      <button
                        key={cid}
                        type="button"
                        onClick={() => setPathWithHash(normalizePath(index, [...path, cid]))}
                        className="max-w-full truncate rounded-full bg-accent/60 px-2.5 py-0.5 text-[13px] hover:bg-accent"
                      >
                        {c.name}
                      </button>
                    )
                  })}
                </div>
              )}
            </section>

            <button
              type="button"
              disabled={busy}
              onClick={() => void removeTopic(selected.id, selected.name)}
              className="mt-2 flex items-center justify-center gap-1.5 rounded-md border border-destructive/40 px-3 py-2 text-[13px] text-destructive hover:bg-destructive/10 disabled:opacity-50"
            >
              <Trash2 className="size-3.5" /> 删除此话题
            </button>
          </div>
        )}
      </aside>

      {picker && index && selectedId ? (
        <TopicPicker
          index={index}
          title={picker.mode === "parent" ? `为「${selected?.name ?? ""}」添加父话题` : `为「${selected?.name ?? ""}」添加子话题`}
          excludeIds={new Set([selectedId])}
          busy={busy}
          onPick={(id) => void pickExisting(id)}
          onCreate={(name) => void createInPicker(name)}
          onClose={() => setPicker(null)}
        />
      ) : null}
    </div>
  )
}
