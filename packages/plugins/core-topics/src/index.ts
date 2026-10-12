import { Context } from '@deepseek-ai/cordis'
import { findCycle, representativePath } from './graph'
import { scoreTopics, type TopicScorable } from './search'

/**
 * 话题（Topic）DAG —— 领域规则 + HTTP 契约。
 *
 * 唯一硬约束：**无环**。所有写边请求都落到 `store.addTopicParent` /
 * `store.setTopicParents`（关系由子话题持有），由存储层在事务内用递归 CTE
 * 判定「新父是否为子的后代」，是则拒绝、零写入。
 *
 * 数据交换形态是**全量图**：读接口返回 `{ topics, edges, rev }`；写接口也回传
 * 新图，前端零补丁、永不漂移（见 docs/话题DAG体系-前后端计划报告.md §3 D2）。
 */

export const name = 'core-topics'
export const inject = ['store', 'api']

const NAME_MAX = 100

interface TopicRow {
  id: string
  name: string
  description: string
  color: string
  createdAt: number
  updatedAt: number
}

interface TopicEdge {
  parentId: string
  childId: string
}

interface TopicGraph {
  topics: TopicRow[]
  edges: TopicEdge[]
  rev: number
}

/** core-topics 实际消费的 store 子集（跨包不引类型，保持插件解耦）。 */
interface TopicStore {
  createTopic(input: { name: string; description?: string; color?: string }): TopicRow
  getTopic(id: string): TopicRow | null
  updateTopic(id: string, patch: { name?: string; description?: string; color?: string }): TopicRow | null
  deleteTopic(id: string): boolean
  listTopics(): TopicRow[]
  listTopicEdges(): TopicEdge[]
  getTopicParents(id: string): TopicRow[]
  getTopicChildren(id: string): TopicRow[]
  addTopicParent(childId: string, parentId: string): 'ok' | 'cycle' | 'self' | 'missing' | 'duplicate'
  setTopicParents(childId: string, parentIds: string[]): 'ok' | 'cycle' | 'missing'
  removeTopicParent(childId: string, parentId: string): boolean
  hasTopicCycle(): boolean
}

export function apply(ctx: Context): void {
  const store = ctx.store as unknown as TopicStore
  const api = ctx.api as any

  const ok = (c: any, data: unknown) => c.json({ ok: true, data, source: 'core-topics', elapsedMs: 0 })
  const fail = (c: any, status: number, code: string, message: string) =>
    c.json({ ok: false, error: { code, message } }, status)

  const graph = (): TopicGraph => {
    const topics = store.listTopics()
    return {
      topics,
      edges: store.listTopicEdges(),
      rev: topics.reduce((max, t) => Math.max(max, t.updatedAt), 0),
    }
  }

  /** childId → 已按名称排序的父列表（representativePath 的确定性输入）。 */
  const parentsOfMap = (): Map<string, string[]> => {
    const topics = store.listTopics()
    const nameById = new Map(topics.map((t) => [t.id, t.name]))
    const map = new Map<string, string[]>()
    for (const e of store.listTopicEdges()) {
      const list = map.get(e.childId)
      if (list) list.push(e.parentId)
      else map.set(e.childId, [e.parentId])
    }
    for (const list of map.values()) {
      list.sort((a, b) => {
        const na = nameById.get(a) ?? a
        const nb = nameById.get(b) ?? b
        return na < nb ? -1 : na > nb ? 1 : 0
      })
    }
    return map
  }

  const readJson = async <T>(c: any): Promise<T | null> => {
    try {
      return (await c.req.json()) as T
    } catch {
      return null
    }
  }

  const normalizeName = (v: unknown): string | null => {
    if (typeof v !== 'string') return null
    const s = v.trim()
    if (!s || s.length > NAME_MAX) return null
    return s
  }

  // ── 静态路径先注册，避免被 /api/topics/:id 抢先匹配 ──

  // A9 模糊搜索（与 web 端同一打分规则；web 主路径是本地搜索）
  api.get('/api/topics/search', (c: any) => {
    const q = String(c.req.query('q') ?? '')
    if (!q.trim()) return ok(c, { results: [], total: 0 })
    const rawLimit = Number(c.req.query('limit') ?? '50')
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 200) : 50

    const topics = store.listTopics()
    const byId = new Map(topics.map((t) => [t.id, t]))
    const childCounts = new Map<string, number>()
    for (const e of store.listTopicEdges()) {
      childCounts.set(e.parentId, (childCounts.get(e.parentId) ?? 0) + 1)
    }
    const scorable: TopicScorable[] = topics.map((t) => ({
      id: t.id,
      name: t.name,
      childCount: childCounts.get(t.id) ?? 0,
    }))
    const pMap = parentsOfMap()
    const results = scoreTopics(scorable, q, limit)
      .filter((h) => byId.has(h.id))
      .map((h) => ({
        topic: byId.get(h.id) as TopicRow,
        score: h.score,
        ranges: h.ranges,
        path: representativePath(h.id, pMap),
      }))
    return ok(c, { results, total: results.length })
  })

  // A10 全图环自检（运维/兜底）
  api.get('/api/topics/validate', (c: any) => {
    const cycle = findCycle(store.listTopicEdges())
    return ok(c, { valid: !cycle, cycles: cycle ? [cycle] : [] })
  })

  // A1 全量图
  api.get('/api/topics', (c: any) => ok(c, graph()))

  // A3 新建话题（可一次带上初始父集合；新节点无后代，不可能成环）
  api.post('/api/topics', async (c: any) => {
    const body = await readJson<{ name?: unknown; description?: unknown; color?: unknown; parentIds?: unknown }>(c)
    if (!body) return fail(c, 400, 'BAD_REQUEST', '请求体需为 JSON：{ name, description?, color?, parentIds? }')
    const topicName = normalizeName(body.name)
    if (!topicName) return fail(c, 400, 'BAD_REQUEST', `name 必填且不超过 ${NAME_MAX} 字符`)
    const parentIds = Array.isArray(body.parentIds)
      ? [...new Set(body.parentIds.filter((x): x is string => typeof x === 'string').map((s) => s.trim()).filter(Boolean))]
      : []
    for (const pid of parentIds) {
      if (!store.getTopic(pid)) return fail(c, 404, 'TOPIC_NOT_FOUND', '父话题不存在或已被删除')
    }
    const created = store.createTopic({
      name: topicName,
      description: typeof body.description === 'string' ? body.description : '',
      color: typeof body.color === 'string' ? body.color : '',
    })
    if (parentIds.length > 0) store.setTopicParents(created.id, parentIds)
    return ok(c, { graph: graph(), topic: store.getTopic(created.id) ?? created })
  })

  // A2 单个话题详情（含全部父/子与一条代表路径）
  api.get('/api/topics/:id', (c: any) => {
    const id = c.req.param('id')
    const topic = store.getTopic(id)
    if (!topic) return fail(c, 404, 'TOPIC_NOT_FOUND', '话题不存在或已被删除')
    return ok(c, {
      topic,
      parents: store.getTopicParents(id),
      children: store.getTopicChildren(id),
      path: representativePath(id, parentsOfMap()),
    })
  })

  // A4 局部更新
  api.patch('/api/topics/:id', async (c: any) => {
    const id = c.req.param('id')
    const body = await readJson<{ name?: unknown; description?: unknown; color?: unknown }>(c)
    if (!body) return fail(c, 400, 'BAD_REQUEST', '请求体需为 JSON：{ name?, description?, color? }')
    const patch: { name?: string; description?: string; color?: string } = {}
    if (body.name !== undefined) {
      const next = normalizeName(body.name)
      if (!next) return fail(c, 400, 'BAD_REQUEST', `name 必填且不超过 ${NAME_MAX} 字符`)
      patch.name = next
    }
    if (typeof body.description === 'string') patch.description = body.description
    if (typeof body.color === 'string') patch.color = body.color
    if (Object.keys(patch).length === 0) return fail(c, 400, 'BAD_REQUEST', '没有可更新的字段')
    const updated = store.updateTopic(id, patch)
    if (!updated) return fail(c, 404, 'TOPIC_NOT_FOUND', '话题不存在或已被删除')
    return ok(c, { graph: graph(), topic: updated })
  })

  // A5 删除（仅本点及其边；子话题保留）
  api.delete('/api/topics/:id', (c: any) => {
    const id = c.req.param('id')
    if (!store.deleteTopic(id)) return fail(c, 404, 'TOPIC_NOT_FOUND', '话题不存在或已被删除')
    return ok(c, { graph: graph(), deletedId: id })
  })

  // A7 原子替换父集合（UI「编辑父话题」主入口）：先整体校验再写入
  api.put('/api/topics/:id/parents', async (c: any) => {
    const id = c.req.param('id')
    const body = await readJson<{ parentIds?: unknown }>(c)
    if (!body || !Array.isArray(body.parentIds)) {
      return fail(c, 400, 'BAD_REQUEST', '请求体需为 JSON：{ parentIds: string[] }')
    }
    const parentIds = [
      ...new Set(body.parentIds.filter((x): x is string => typeof x === 'string').map((s) => s.trim()).filter(Boolean)),
    ]
    const r = store.setTopicParents(id, parentIds)
    if (r === 'ok') return ok(c, { graph: graph() })
    if (r === 'cycle') return fail(c, 409, 'TOPIC_CYCLE', '该父子关系会形成环，已阻止')
    return fail(c, 404, 'TOPIC_NOT_FOUND', '话题不存在或已被删除')
  })

  // A6 给子话题增加一个父话题
  api.post('/api/topics/:id/parents', async (c: any) => {
    const childId = c.req.param('id')
    const body = await readJson<{ parentId?: unknown }>(c)
    if (!body) return fail(c, 400, 'BAD_REQUEST', '请求体需为 JSON：{ parentId }')
    const parentId = typeof body.parentId === 'string' ? body.parentId.trim() : ''
    if (!parentId) return fail(c, 400, 'BAD_REQUEST', '缺少 parentId')
    const r = store.addTopicParent(childId, parentId)
    switch (r) {
      case 'ok':
      case 'duplicate': // 幂等
        return ok(c, { graph: graph() })
      case 'cycle':
        return fail(c, 409, 'TOPIC_CYCLE', '该父子关系会形成环，已阻止')
      case 'self':
        return fail(c, 400, 'TOPIC_SELF_PARENT', '话题不能作为自己的父话题')
      default:
        return fail(c, 404, 'TOPIC_NOT_FOUND', '话题不存在或已被删除')
    }
  })

  // A8 移除一条父边（父边本就不存在时幂等成功）
  api.delete('/api/topics/:id/parents/:parentId', (c: any) => {
    const childId = c.req.param('id')
    const parentId = c.req.param('parentId')
    if (!store.getTopic(childId)) return fail(c, 404, 'TOPIC_NOT_FOUND', '话题不存在或已被删除')
    const removed = store.removeTopicParent(childId, parentId)
    return ok(c, { graph: graph(), removed })
  })

  // 启动自检：仅告警，不阻断（脏数据可从 /api/topics/validate 排查）
  try {
    if (store.hasTopicCycle()) {
      ctx.logger?.('core-topics').warn('检测到话题图存在环，请调用 GET /api/topics/validate 排查')
    }
  } catch {
    // 自检失败不影响启动
  }
}
