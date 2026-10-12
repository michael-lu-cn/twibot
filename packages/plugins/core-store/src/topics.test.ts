import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { Context } from '@deepseek-ai/cordis'
import { apply, type StoreService } from './index'

/**
 * 话题 DAG 的存储层验收：无环铁律 + 多父结构 + 删除语义。
 * 用真实 core-store（临时 SQLite 文件），不 mock，确保 SQL/事务路径被覆盖。
 */

interface Harness {
  store: StoreService
  dbFile: string
  dispose: () => Promise<void>
}

async function harness(): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), 'twibot-topic-'))
  const dbFile = join(dir, 'test.db')
  const ctx = new Context()
  apply(ctx, { file: dbFile })
  const store = ctx.get('store') as StoreService
  return {
    store,
    dbFile,
    dispose: async () => {
      await ctx.fiber.dispose().catch(() => {})
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

/** 建话题并返回 id（名字即句柄，便于断言）。 */
function mk(store: StoreService, name: string): string {
  return store.createTopic({ name }).id
}

test('话题 CRUD 与列表排序', async () => {
  const h = await harness()
  try {
    const b = mk(h.store, 'Beta')
    const a = mk(h.store, 'alpha')
    assert.equal(h.store.getTopic(a)?.name, 'alpha')
    assert.deepEqual(
      h.store.listTopics().map((t) => t.name),
      ['alpha', 'Beta'], // name COLLATE NOCASE 升序
    )
    const updated = h.store.updateTopic(b, { name: 'beta2', description: 'desc' })
    assert.equal(updated?.name, 'beta2')
    assert.equal(updated?.description, 'desc')
    assert.equal(h.store.updateTopic('t_missing', { name: 'x' }), null)
    assert.equal(h.store.deleteTopic(b), true)
    assert.equal(h.store.deleteTopic(b), false)
    assert.equal(h.store.getTopic(b), null)
  } finally {
    await h.dispose()
  }
})

test('加父：正常、幂等、自环、缺失', async () => {
  const h = await harness()
  try {
    const a = mk(h.store, 'A')
    const b = mk(h.store, 'B')
    assert.equal(h.store.addTopicParent(b, a), 'ok')
    assert.equal(h.store.addTopicParent(b, a), 'duplicate') // 幂等
    assert.equal(h.store.listTopicEdges().length, 1)
    assert.equal(h.store.addTopicParent(a, a), 'self')
    assert.equal(h.store.addTopicParent(a, 't_missing'), 'missing')
    assert.equal(h.store.addTopicParent('t_missing', a), 'missing')
    assert.deepEqual(h.store.getTopicParents(b).map((t) => t.name), ['A'])
    assert.deepEqual(h.store.getTopicChildren(a).map((t) => t.name), ['B'])
    assert.deepEqual(h.store.getTopicRoots().map((t) => t.name), ['A'])
  } finally {
    await h.dispose()
  }
})

test('无环铁律：直接环与传递环都被拒绝且零写入', async () => {
  const h = await harness()
  try {
    const a = mk(h.store, 'A')
    const b = mk(h.store, 'B')
    const c = mk(h.store, 'C')
    assert.equal(h.store.addTopicParent(b, a), 'ok') // A -> B
    assert.equal(h.store.addTopicParent(c, b), 'ok') // B -> C
    const before = h.store.listTopicEdges().length
    // 直接环：B 已是 A 的子，再把 B 作为 A 的父 => A -> B 与 B -> A
    assert.equal(h.store.addTopicParent(a, b), 'cycle')
    // 传递环：C -> A 会形成 A -> B -> C -> A
    assert.equal(h.store.addTopicParent(a, c), 'cycle')
    assert.equal(h.store.listTopicEdges().length, before, '被拒绝的写不得留下任何边')
    assert.equal(h.store.hasTopicCycle(), false)
  } finally {
    await h.dispose()
  }
})

test('多父/菱形结构合法', async () => {
  const h = await harness()
  try {
    const a = mk(h.store, 'A')
    const b = mk(h.store, 'B')
    const c = mk(h.store, 'C')
    const d = mk(h.store, 'D')
    assert.equal(h.store.addTopicParent(c, a), 'ok')
    assert.equal(h.store.addTopicParent(c, b), 'ok')
    assert.equal(h.store.addTopicParent(d, a), 'ok')
    assert.equal(h.store.addTopicParent(d, b), 'ok')
    assert.deepEqual(h.store.getTopicParents(c).map((t) => t.name), ['A', 'B'])
    assert.equal(h.store.hasTopicCycle(), false)
    // 代表路径向上取最短：C 的父按名字排序取 A
    assert.deepEqual(new Set(h.store.getTopicDescendantIds(a)), new Set([c, d]))
  } finally {
    await h.dispose()
  }
})

test('setTopicParents：原子替换；含后代候选则整批拒绝零写入', async () => {
  const h = await harness()
  try {
    const a = mk(h.store, 'A')
    const b = mk(h.store, 'B')
    const c = mk(h.store, 'C')
    const d = mk(h.store, 'D')
    // C 的父 = [A]
    assert.equal(h.store.setTopicParents(c, [a]), 'ok')
    // 替换为 [B]
    assert.equal(h.store.setTopicParents(c, [b]), 'ok')
    assert.deepEqual(h.store.getTopicParents(c).map((t) => t.name), ['B'])
    // 建立 B -> D，再尝试把 D 的父设为 C（C 是 D 的祖先 A->C? 不）
    assert.equal(h.store.addTopicParent(d, b), 'ok') // B -> D
    // 现在图：B->C, B->D。给 C 设父 [D]：D 不是 C 的后代 => 合法
    assert.equal(h.store.setTopicParents(c, [d]), 'ok')
    // 给 D 设父 [C]：C 是 D 的后代（D->C 已存在）=> 成环，整批拒绝
    const before = h.store.listTopicEdges()
    assert.equal(h.store.setTopicParents(d, [a, c]), 'cycle')
    assert.deepEqual(h.store.listTopicEdges(), before, '成环时 setTopicParents 必须零写入')
    assert.equal(h.store.setTopicParents('t_missing', [a]), 'missing')
    assert.equal(h.store.setTopicParents(c, [c]), 'cycle') // 自环
  } finally {
    await h.dispose()
  }
})

test('删除节点：清边、保留子话题、无悬挂边', async () => {
  const h = await harness()
  try {
    const a = mk(h.store, 'A')
    const b = mk(h.store, 'B')
    const c = mk(h.store, 'C')
    assert.equal(h.store.addTopicParent(b, a), 'ok') // A -> B
    assert.equal(h.store.addTopicParent(c, a), 'ok') // A -> C
    assert.equal(h.store.addTopicParent(c, b), 'ok') // B -> C（多父）
    assert.equal(h.store.deleteTopic(a), true)
    assert.equal(h.store.getTopic(a), null)
    // A 的边全清，C 保留且仍有父 B
    assert.equal(h.store.listTopicEdges().some((e) => e.parentId === a || e.childId === a), false)
    assert.equal(h.store.getTopic(c)?.name, 'C')
    assert.deepEqual(h.store.getTopicParents(c).map((t) => t.name), ['B'])
    assert.equal(h.store.hasTopicCycle(), false)
  } finally {
    await h.dispose()
  }
})

test('hasTopicCycle 能检出被绕过 API 直接写入的环', async () => {
  const h = await harness()
  try {
    const a = mk(h.store, 'A')
    const b = mk(h.store, 'B')
    assert.equal(h.store.addTopicParent(b, a), 'ok')
    assert.equal(h.store.hasTopicCycle(), false)
    // 绕过 store 直接插 B -> A 的边，制造 A -> B -> A 的环
    const raw = new Database(h.dbFile)
    raw.prepare('INSERT INTO topic_edges (parent_id, child_id, created_at) VALUES (?, ?, ?)').run(b, a, Date.now())
    raw.close()
    assert.equal(h.store.hasTopicCycle(), true)
  } finally {
    await h.dispose()
  }
})
