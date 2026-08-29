import { describe, expect, it, vi } from 'vitest'
import { createSlotCore } from '../src/index.ts'

describe('single-slot shadowing (ascending priority)', () => {
  it('lowest priority wins', () => {
    const core = createSlotCore<string>()
    core.register('panel', 'base')
    core.register('panel', 'premium', { priority: 5 })
    core.register('panel', 'lite', { priority: -3 })
    expect(core.resolveSlot('panel')?.entry).toBe('lite')
    expect(core.resolveSlot('panel')?.priority).toBe(-3)
  })

  it('a higher-priority registration does not hide the lower one', () => {
    const core = createSlotCore<string>()
    core.register('panel', 'base')
    core.register('panel', 'premium', { priority: 5 })
    // Ascending semantics: low renders; the high entry merely waits to shadow.
    expect(core.resolveSlot('panel')?.entry).toBe('base')
  })

  it('a newly registered smaller priority flips the winner', () => {
    const core = createSlotCore<string>()
    core.register('hero', 'v1')
    expect(core.resolveSlot('hero')?.entry).toBe('v1')
    const disposeLite = core.register('hero', 'v0', { priority: -1 })
    expect(core.resolveSlot('hero')?.entry).toBe('v0')
    disposeLite()
    expect(core.resolveSlot('hero')?.entry).toBe('v1')
  })

  it('the visible list exposes only per-cell winners in ledger order', () => {
    const core = createSlotCore<string>()
    core.register('panel', 'shadowed', { priority: 9 })
    core.register('panel', 'winner')
    const visible = core.entriesOf('panel')
    expect(visible.map(row => row.entry)).toEqual(['winner'])
    expect(Object.isFrozen(visible)).toBe(true)
  })
})

describe('same-cell same-priority conflict', () => {
  it('throws on a single slot, naming slot, priority, and the shadow guidance', () => {
    const core = createSlotCore<string>()
    core.register('panel', 'first')
    expect(() => core.register('panel', 'second')).toThrowError(
      /single slot "panel" already has a registration at priority 0 .*register at a different priority to shadow it \(lowest renders\)/,
    )
  })

  it('default priority collides with an explicit 0', () => {
    const core = createSlotCore<string>()
    core.register('panel', 'first')
    expect(() => core.register('panel', 'second', { priority: 0 })).toThrowError(/at priority 0/)
  })

  it('throws on a keyed cell, naming key as well', () => {
    const core = createSlotCore<string>()
    core.register('tabs', 'first', { key: 'home' })
    expect(() => core.register('tabs', 'second', { key: 'home' })).toThrowError(
      /keyed slot "tabs" already has an entry for key "home" at priority 0/,
    )
  })

  it('releasing the occupant frees the priority again', () => {
    const core = createSlotCore<string>()
    const disposeFirst = core.register('panel', 'first')
    disposeFirst()
    expect(() => core.register('panel', 'second')).not.toThrow()
    expect(core.resolveSlot('panel')?.entry).toBe('second')
  })
})

describe('tie stability (registration order)', () => {
  it('equal priorities across keyed cells keep registration order in the projection', () => {
    const core = createSlotCore<string>()
    core.register('tabs', 'first', { key: 'a', priority: 5 })
    core.register('tabs', 'second', { key: 'b', priority: 5 })
    core.register('tabs', 'urgent', { key: 'c', priority: 1 })
    expect(core.entriesOf('tabs').map(row => row.entry)).toEqual(['urgent', 'first', 'second'])
  })

  it('the earlier registrant keeps a contested priority; the later one throws', () => {
    const core = createSlotCore<string>()
    core.register('panel', 'early', { priority: 2 })
    expect(() => core.register('panel', 'late', { priority: 2 }))
      .toThrowError(/already has a registration at priority 2/)
    expect(core.resolveSlot('panel')?.entry).toBe('early')
  })
})

describe('disposal and reactivity', () => {
  it('disposing the winner falls back to the next-lowest live entry', () => {
    const core = createSlotCore<string>()
    const disposeLow = core.register('panel', 'low', { priority: -1 })
    core.register('panel', 'mid', { priority: 4 })
    core.register('panel', 'high', { priority: 9 })
    expect(core.resolveSlot('panel')?.entry).toBe('low')
    disposeLow()
    expect(core.resolveSlot('panel')?.entry).toBe('mid')
  })

  it('the disposer is idempotent and notifies subscribers once', () => {
    const core = createSlotCore<string>()
    const dispose = core.register('panel', 'only')
    const seen: string[] = []
    core.subscribe(slotId => seen.push(slotId))
    dispose()
    dispose()
    // One commit, one notification — the stale second call must not re-notify.
    expect(seen).toEqual(['panel'])
    expect(core.entriesOf('panel')).toEqual([])
  })

  it('subscribers are notified synchronously of registrations and removals', () => {
    const core = createSlotCore<string>()
    const listener = vi.fn()
    const unsubscribe = core.subscribe(listener)
    const dispose = core.register('hero', 'v1')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenLastCalledWith('hero')
    dispose()
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
    core.register('hero', 'v2')
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('a reentrant mutation inside a listener skips no listener on either commit', () => {
    const core = createSlotCore<string>()
    const order: string[] = []
    let nested = false
    core.subscribe(slotId => {
      order.push(`a:${slotId}`)
      if (!nested) {
        nested = true
        core.register(slotId, 'nested', { priority: -1 })
      }
    })
    core.subscribe(slotId => order.push(`b:${slotId}`))
    core.register('panel', 'seed')
    // Outer commit notifies a then b; the nested insert notifies both again.
    expect(order).toEqual(['a:panel', 'a:panel', 'b:panel', 'b:panel'])
    expect(core.resolveSlot('panel')?.entry).toBe('nested')
  })
})

describe('keyed cells', () => {
  it('cells shadow independently within one keyed slot', () => {
    const core = createSlotCore<string>()
    core.register('grid', 'k1-base', { key: 'k1' })
    core.register('grid', 'k1-shadow', { key: 'k1', priority: 2 })
    core.register('grid', 'k2-base', { key: 'k2' })

    expect(core.resolveSlot('grid', 'k1')?.entry).toBe('k1-base')
    expect(core.resolveSlot('grid', 'k2')?.entry).toBe('k2-base')

    core.register('grid', 'k1-tiny', { key: 'k1', priority: -1 })
    expect(core.resolveSlot('grid', 'k1')?.entry).toBe('k1-tiny')
    // The k2 cell never moved.
    expect(core.resolveSlot('grid', 'k2')?.entry).toBe('k2-base')
  })

  it('different keys never collide at the same priority', () => {
    const core = createSlotCore<string>()
    core.register('tabs', 'a', { key: 'left' })
    expect(() => core.register('tabs', 'b', { key: 'right' })).not.toThrow()
  })

  it('disposal in one cell leaves other cells untouched', () => {
    const core = createSlotCore<string>()
    const disposeK1 = core.register('grid', 'k1-only', { key: 'k1' })
    core.register('grid', 'k2-only', { key: 'k2' })
    disposeK1()
    expect(core.entriesOf('grid', 'k1')).toEqual([])
    expect(core.resolveSlot('grid')?.entry).toBe('k2-only')
    expect(core.resolveSlot('grid', 'k2')).toEqual(
      expect.objectContaining({ entry: 'k2-only', key: 'k2', priority: 0 }),
    )
  })

  it('resolving an empty or unknown cell yields undefined', () => {
    const core = createSlotCore<string>()
    expect(core.resolveSlot('nowhere')).toBeUndefined()
    expect(core.entriesOf('nowhere', 'any')).toEqual([])
    core.register('grid', 'solo')
    expect(core.resolveSlot('grid', 'missing-key')).toBeUndefined()
    expect(core.resolveSlot('grid')?.entry).toBe('solo')
  })
})
