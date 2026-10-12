/**
 * 话题模糊搜索打分（纯函数，零依赖，浏览器本地即时搜索的主实现）。
 *
 * ⚠️ 本文件与 `packages/plugins/core-topics/src/search.ts` **规则必须逐字一致**
 * （后者服务 `/api/topics/search`；两者是同一套规则的两份实现，见计划报告 D1）。
 * 改动任一文件都必须同步另一份，并保持两侧单测用同一组用例。
 *
 * 分层打分（高 → 低）：完全相等 1000 > 前缀 800 > 连续子串 600-… > 子序列 300-…
 * 归一化：NFKC（全角→半角）+ 小写 + trim，中文按字符参与子串/子序列。
 */

export interface TopicScorable {
  id: string
  name: string
  /** 直接子话题数，用于轻量加权（被引用多的话题更可能相关）。 */
  childCount?: number
}

export interface TopicScoreHit {
  id: string
  score: number
  /** 命中区间（归一化文本上的 [start, end)），供前端高亮。 */
  ranges: Array<[number, number]>
}

export interface FuzzyMatch {
  score: number
  ranges: Array<[number, number]>
}

function normalize(s: string): string {
  return s.normalize("NFKC").toLowerCase().trim()
}

/** 单个文本的模糊匹配；无命中返回 null。 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = normalize(query)
  const t = normalize(text)
  if (!q || !t) return null

  if (t === q) return { score: 1000, ranges: [[0, t.length]] }

  if (t.startsWith(q)) return { score: 800, ranges: [[0, q.length]] }

  const at = t.indexOf(q)
  if (at >= 0) {
    const score = 600 - at * 2 - (t.length - q.length)
    return { score, ranges: [[at, at + q.length]] }
  }

  // 子序列：查询字符按序出现（可间隔）
  const positions: number[] = []
  let cursor = 0
  for (const ch of q) {
    const found = t.indexOf(ch, cursor)
    if (found === -1) return null
    positions.push(found)
    cursor = found + 1
  }
  let gaps = positions[0] > 0 ? 1 : 0
  for (let i = 1; i < positions.length; i++) {
    if (positions[i] !== positions[i - 1] + 1) gaps++
  }
  const ranges: Array<[number, number]> = []
  for (const pos of positions) {
    const last = ranges[ranges.length - 1]
    if (last && last[1] === pos) last[1] = pos + 1
    else ranges.push([pos, pos + 1])
  }
  return { score: 300 - gaps * 3, ranges }
}

/** 对一组话题打分并排序：score desc → 名称短者优先 → 名称字典序；截断到 limit。 */
export function scoreTopics(nodes: TopicScorable[], query: string, limit = 50): TopicScoreHit[] {
  const scored: Array<{ node: TopicScorable; score: number; ranges: Array<[number, number]> }> = []
  for (const node of nodes) {
    const m = fuzzyMatch(query, node.name)
    if (!m) continue
    scored.push({ node, score: m.score + Math.min(node.childCount ?? 0, 10), ranges: m.ranges })
  }
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      a.node.name.length - b.node.name.length ||
      (a.node.name < b.node.name ? -1 : a.node.name > b.node.name ? 1 : 0),
  )
  return scored.slice(0, limit).map((s) => ({ id: s.node.id, score: s.score, ranges: s.ranges }))
}
