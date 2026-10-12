import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fuzzyMatch, scoreTopics } from './search'

/**
 * 打分规则验收。⚠️ 与 `apps/web/src/lib/topic-search.test.ts` 必须使用**同一组用例**
 * （两份实现规则逐字一致，见计划报告 D1）。
 */

test('fuzzyMatch：分层打分与高亮区间', () => {
  assert.deepEqual(fuzzyMatch('AI', 'AI'), { score: 1000, ranges: [[0, 2]] })
  assert.deepEqual(fuzzyMatch('ai', 'AI安全'), { score: 800, ranges: [[0, 2]] })
  // 子串：'模型' 在 '大模型' 的 index 1
  const sub = fuzzyMatch('模型', '大模型')
  assert.equal(sub?.score, 600 - 1 * 2 - (3 - 2))
  assert.deepEqual(sub?.ranges, [[1, 3]])
  // 子序列：'ml' 命中 'machine learning'（m@0, l@8）
  const seq = fuzzyMatch('ml', 'machine learning')
  assert.equal(seq?.score, 300 - 1 * 3)
  assert.deepEqual(seq?.ranges, [[0, 1], [8, 9]])
})

test('fuzzyMatch：归一化（全角/大小写）与无命中', () => {
  assert.deepEqual(fuzzyMatch('ａｉ', 'AI'), { score: 1000, ranges: [[0, 2]] })
  assert.equal(fuzzyMatch('xyz', '大模型'), null)
  assert.equal(fuzzyMatch('', 'AI'), null)
  assert.equal(fuzzyMatch('AI', ''), null)
})

test('scoreTopics：排序（精确 > 前缀带权重）与截断', () => {
  const nodes = [
    { id: 'a', name: 'AI' },
    { id: 'b', name: 'AI 安全', childCount: 5 },
    { id: 'c', name: '机器学习' },
  ]
  const hits = scoreTopics(nodes, 'ai')
  assert.deepEqual(hits.map((h) => h.id), ['a', 'b']) // c 无命中
  assert.equal(hits[0]?.score, 1000)
  assert.equal(hits[1]?.score, 805) // 前缀 800 + childCount 5
  assert.equal(scoreTopics(nodes, 'ai', 1).length, 1)
})
