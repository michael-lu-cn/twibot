/**
 * 话题 DAG 的纯图函数（零依赖、零 IO，可直接单测）。
 *
 * 与 web 端 `apps/web/src/lib/topic-graph.ts` 的分工：这里只做**全图校验**
 * （环检测、代表路径），邻接索引在前端构建（数据在浏览器内存里）。
 */

export interface GraphEdge {
  parentId: string
  childId: string
}

/**
 * 检测有向图中的任一环。
 * @returns 环上的节点序列（首尾同一节点，如 `['A','B','C','A']`）；无环返回 null。
 *
 * 三色 DFS：灰色 = 当前递归栈内，遇到灰色即回边 = 环。递归深度与最长路径成正比，
 * 话题量级（< 5k 节点）下安全。
 */
export function findCycle(edges: GraphEdge[]): string[] | null {
  const adj = new Map<string, string[]>()
  const nodes = new Set<string>()
  for (const e of edges) {
    nodes.add(e.parentId)
    nodes.add(e.childId)
    const list = adj.get(e.parentId)
    if (list) list.push(e.childId)
    else adj.set(e.parentId, [e.childId])
  }

  const WHITE = 0
  const GRAY = 1
  const BLACK = 2
  const color = new Map<string, number>()
  for (const n of nodes) color.set(n, WHITE)
  const stack: string[] = []

  const visit = (u: string): string[] | null => {
    color.set(u, GRAY)
    stack.push(u)
    for (const v of adj.get(u) ?? []) {
      const c = color.get(v) ?? WHITE
      if (c === GRAY) {
        const at = stack.indexOf(v)
        return [...stack.slice(at >= 0 ? at : 0), v]
      }
      if (c === WHITE) {
        const found = visit(v)
        if (found) return found
      }
    }
    stack.pop()
    color.set(u, BLACK)
    return null
  }

  for (const n of nodes) {
    if ((color.get(n) ?? WHITE) === WHITE) {
      const found = visit(n)
      if (found) return found
    }
  }
  return null
}

/**
 * 代表路径：从某话题向上 BFS 到最近的一个根，返回 root → … → id。
 * 多父 DAG 下没有唯一路径，这里给一条**最短**的用于面包屑/深链定位；
 * 同层父按输入顺序（store 已按 name 排序）确定性选择。
 */
export function representativePath(id: string, parentsOf: Map<string, string[]>): string[] {
  const toward: Map<string, string | null> = new Map([[id, null]])
  const queue: string[] = [id]
  let root = id
  while (queue.length > 0) {
    const u = queue.shift() as string
    const ps = parentsOf.get(u) ?? []
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
