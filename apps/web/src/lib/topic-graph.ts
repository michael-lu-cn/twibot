/**
 * 话题 DAG 的前端图索引与路径工具（纯函数，零 React）。
 *
 * 数据来源：`GET /api/topics` 的**全量图** `{ topics, edges }`。Finder 列视图
 * 与本地模糊搜索都建立在这份内存索引上（见计划报告 §4.4）。
 */

import type { TopicGraph, TopicNode } from "./api"

export interface TopicIndex {
  byId: Map<string, TopicNode>
  /** parentId → 子 id 列表（按名称排序，保证列顺序稳定） */
  childrenOf: Map<string, string[]>
  /** childId → 父 id 列表（按名称排序） */
  parentsOf: Map<string, string[]>
  /** 无父节点（含孤立节点），按名称排序 */
  roots: string[]
  /** 直接子话题数，用于搜索轻量加权 */
  childCount: Map<string, number>
}

function push(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

const byName = (nameOf: (id: string) => string) => (a: string, b: string): number => {
  const na = nameOf(a)
  const nb = nameOf(b)
  return na < nb ? -1 : na > nb ? 1 : 0
}

export function buildIndex(graph: TopicGraph): TopicIndex {
  const byId = new Map(graph.topics.map((t) => [t.id, t]))
  const nameOf = (id: string): string => byId.get(id)?.name ?? id
  const childrenOf = new Map<string, string[]>()
  const parentsOf = new Map<string, string[]>()
  for (const e of graph.edges) {
    // 悬挂边（节点已被删）直接忽略，避免脏数据污染 UI
    if (!byId.has(e.parentId) || !byId.has(e.childId)) continue
    push(childrenOf, e.parentId, e.childId)
    push(parentsOf, e.childId, e.parentId)
  }
  for (const list of childrenOf.values()) list.sort(byName(nameOf))
  for (const list of parentsOf.values()) list.sort(byName(nameOf))

  const childCount = new Map<string, number>()
  for (const [id, list] of childrenOf) childCount.set(id, list.length)

  const roots = graph.topics
    .filter((t) => (parentsOf.get(t.id)?.length ?? 0) === 0)
    .map((t) => t.id)
    .sort(byName(nameOf))

  return { byId, childrenOf, parentsOf, roots, childCount }
}

/**
 * 代表路径：从 id 向上 BFS 到最近的一个根，返回 root → … → id。
 * 多父 DAG 下没有唯一路径，返回一条**最短**的用于面包屑/深链定位。
 */
export function pathToRoot(index: TopicIndex, id: string): string[] {
  if (!index.byId.has(id)) return []
  const toward = new Map<string, string | null>([[id, null]])
  const queue: string[] = [id]
  let root = id
  while (queue.length > 0) {
    const u = queue.shift() as string
    const ps = index.parentsOf.get(u) ?? []
    if (ps.length === 0) {
      root = u
      break
    }
    for (const p of ps) {
      if (!toward.has(p)) {
        toward.set(p, u)
        queue.push(p)
      }
    }
  }
  const path: string[] = []
  let cur: string | null = root
  while (cur !== null) {
    path.push(cur)
    cur = toward.get(cur) ?? null
  }
  return path
}

/**
 * 修剪/规范化浏览路径：逐级校验「下一节点确实是上一节点的子」。
 * 任一节点被删或层级关系失效时就地收敛到一条仍有效的代表路径。
 * 保证返回值从根开始、无重复。
 */
export function normalizePath(index: TopicIndex, path: string[]): string[] {
  const result: string[] = []
  for (const id of path) {
    if (!index.byId.has(id)) break
    if (result.length === 0) {
      result.push(...pathToRoot(index, id))
      continue
    }
    const parent = result[result.length - 1]
    if ((index.childrenOf.get(parent) ?? []).includes(id)) {
      result.push(id)
    } else {
      return pathToRoot(index, id)
    }
  }
  return [...new Set(result)]
}
