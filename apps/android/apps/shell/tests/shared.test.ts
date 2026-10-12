/**
 * shareModule:跨「壳 ↔ 远端 chunk」的单例登记处。
 *
 * 它存在的唯一理由就是边界两侧各有自己的一份模块求值结果,所以这里的用例
 * 也用「两份模块副本」来验 —— 只看同一个函数调用两次是测不出问题的。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { shareModule } from '../src/shared'

const holder = globalThis as typeof globalThis & { __face_shared?: Record<string, unknown> }

afterEach(() => {
  // 每个用例用独立 key,这里只兜底清理本文件的登记,避免污染同进程其它测试。
  for (const key of Object.keys(holder.__face_shared ?? {})) {
    if (key.startsWith('test:')) delete holder.__face_shared![key]
  }
})

describe('shareModule', () => {
  it('同一 key 只建一次实例(factory 只跑一次)', () => {
    let calls = 0
    const factory = () => ({ calls: ++calls })
    const first = shareModule('test:once', factory)
    const second = shareModule('test:once', factory)

    expect(second).toBe(first)
    expect(calls).toBe(1)
  })

  it('不同 key 各自独立', () => {
    const a = shareModule('test:a', () => ({ tag: 'a' }))
    const b = shareModule('test:b', () => ({ tag: 'b' }))

    expect(a).not.toBe(b)
    expect(a).toEqual({ tag: 'a' })
  })

  it('实例落在 globalThis 的登记表上(跨副本共享的载体)', () => {
    const instance = shareModule('test:global', () => ({ tag: 'global' }))

    expect(holder.__face_shared?.['test:global']).toBe(instance)
  })

  it('第二份模块副本(模拟 chunk 里那份 shared.ts)复用先到者的实例', async () => {
    const shellCopy = shareModule('test:boundary', () => ({ from: 'shell' }))
    vi.resetModules()
    const chunkCopy = await import('../src/shared')

    expect(chunkCopy.shareModule).not.toBe(shareModule)
    expect(chunkCopy.shareModule('test:boundary', () => ({ from: 'chunk' }))).toBe(shellCopy)
  })
})
