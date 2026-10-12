import { test } from "node:test"
import assert from "node:assert/strict"
import { buildIndex, normalizePath, pathToRoot } from "../src/lib/topic-graph"
import type { TopicGraph, TopicNode } from "../src/lib/api"

const n = (id: string, name: string): TopicNode => ({
  id,
  name,
  description: "",
  color: "",
  createdAt: 0,
  updatedAt: 0,
})

/** 菱形 + 链：A→C, B→C, C→D（C 有两个父） */
const graph: TopicGraph = {
  topics: [n("A", "AI"), n("B", "数学"), n("C", "大模型"), n("D", "多模态")],
  edges: [
    { parentId: "A", childId: "C" },
    { parentId: "B", childId: "C" },
    { parentId: "C", childId: "D" },
  ],
  rev: 0,
}

test("buildIndex：邻接表、根、子数、排序", () => {
  const idx = buildIndex(graph)
  assert.deepEqual(idx.roots, ["A", "B"]) // AI < 数学？按 id 名排序，这里用 name 比较
  assert.deepEqual(idx.parentsOf.get("C"), ["A", "B"])
  assert.deepEqual(idx.childrenOf.get("C"), ["D"])
  assert.equal(idx.childCount.get("A"), 1)
  assert.equal(idx.childCount.get("D"), undefined)
  assert.equal(idx.byId.get("C")?.name, "大模型")
})

test("buildIndex：忽略悬挂边（节点已删）", () => {
  const idx = buildIndex({
    ...graph,
    edges: [...graph.edges, { parentId: "A", childId: "t_missing" }],
  })
  assert.equal(idx.childCount.get("A"), 1)
  assert.equal(idx.childrenOf.get("A")?.includes("t_missing"), false)
})

test("pathToRoot：多父取一条最短代表路径", () => {
  const idx = buildIndex(graph)
  assert.deepEqual(pathToRoot(idx, "D"), ["A", "C", "D"]) // C 的父按 name 排序取 A(AI)
  assert.deepEqual(pathToRoot(idx, "A"), ["A"])
  assert.deepEqual(pathToRoot(idx, "t_missing"), [])
})

test("normalizePath：校验层级、收敛到根、容忍删除", () => {
  const idx = buildIndex(graph)
  assert.deepEqual(normalizePath(idx, ["A", "C", "D"]), ["A", "C", "D"])
  assert.deepEqual(normalizePath(idx, ["B", "C"]), ["B", "C"])
  // 只给一个非根节点：补全到根
  assert.deepEqual(normalizePath(idx, ["D"]), ["A", "C", "D"])
  // 中途节点被删：就地截断
  assert.deepEqual(normalizePath(idx, ["A", "t_missing", "D"]), ["A"])
  // 层级关系失效：回退到该节点的代表路径
  assert.deepEqual(normalizePath(idx, ["A", "B"]), ["B"])
})
