import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findCycle, representativePath, type GraphEdge } from './graph'

const e = (parentId: string, childId: string): GraphEdge => ({ parentId, childId })

test('findCycle：无环返回 null', () => {
  assert.equal(findCycle([]), null)
  assert.equal(findCycle([e('A', 'B')]), null)
  // 菱形 A->C, B->C, A->D, B->D
  assert.equal(findCycle([e('A', 'C'), e('B', 'C'), e('A', 'D'), e('B', 'D')]), null)
})

test('findCycle：检出直接环与传递环', () => {
  assert.deepEqual(findCycle([e('A', 'B'), e('B', 'A')]), ['A', 'B', 'A'])
  assert.deepEqual(findCycle([e('A', 'B'), e('B', 'C'), e('C', 'A')]), ['A', 'B', 'C', 'A'])
})

test('representativePath：向上取最短到根的路径', () => {
  const parentsOf = new Map<string, string[]>([
    ['C', ['A', 'B']],
    ['A', []],
    ['B', []],
  ])
  assert.deepEqual(representativePath('C', parentsOf), ['A', 'C'])
  assert.deepEqual(representativePath('A', parentsOf), ['A'])
  // 不存在的 id 也要兜底成自身路径
  assert.deepEqual(representativePath('Z', parentsOf), ['Z'])
})

test('representativePath：多层链路 root -> … -> id', () => {
  const parentsOf = new Map<string, string[]>([
    ['D', ['C']],
    ['C', ['A']],
    ['A', []],
  ])
  assert.deepEqual(representativePath('D', parentsOf), ['A', 'C', 'D'])
})
