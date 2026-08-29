/**
 * Priority-slot composition core: a registry where entries sharing one cell
 * coexist at distinct priorities and the lowest live priority renders
 * (ascending shadowing rank). Semantics mirror the dsh ui-slots `SlotCore`
 * (tmp-research/deepseek-harness/packages/client/ui-slots/src/index.ts:
 * `register` shadowing contract and the `entriesOfSlot` winner projection).
 *
 * Platform-agnostic and dependency-free: no React, no DOM, no scheduler. The
 * RN shell wraps this core with native components later; reactivity is a bare
 * listener set notified synchronously after each committed mutation.
 *
 * Deliberate reductions against the upstream registry (MVP scope):
 * - Cells are `single` (the slot itself) and `keyed` (same `options.key`);
 *   there is no declaration table, no list `order` refinement, no chain
 *   election, and no child-slot cascade.
 * - Any slot id materializes its record on first touch — registering into a
 *   never-declared slot is legal here (upstream fails loud without a parent
 *   declaration; this shell has no declaration topology yet).
 * - Notifications fire synchronously per mutation (upstream batches
 *   `subscribe` per microtask for React render coalescing; the future native
 *   wrapper owns its own batching).
 */

/** Registration options shaping the entry's cell and shadowing rank. */
export interface SlotRegistrationOptions {
  /**
   * Cell shadowing rank (ascending, default 0, lowest renders). A second LIVE
   * registration in the same cell at the same rank throws — register at a
   * different priority to shadow instead.
   */
  priority?: number
  /**
   * Keyed-cell dispatch key. Entries sharing one key form one cell; omit to
   * occupy the slot's single implicit cell.
   */
  key?: string
}

/** One stored registration as exposed by reads. */
export interface RegisteredSlotEntry<T> {
  /** Registrant-supplied payload the host renders. */
  readonly entry: T
  /** Effective shadowing rank (the `priority ?? 0` default applied). */
  readonly priority: number
  /** Keyed cell of the entry, or undefined for the single implicit cell. */
  readonly key: string | undefined
}

/**
 * Change listener invoked after each committed mutation.
 * @param slotId - id of the slot whose ledger changed.
 */
export type SlotChangeListener = (slotId: string) => void

/** Live rows of one slot, kept ascending by priority (ties in registration order). */
interface SlotRecord<T> {
  rows: RegisteredSlotEntry<T>[]
}

const EMPTY_ROWS: readonly never[] = Object.freeze([])

/** Read/projection surface of one priority-slot registry. */
export interface SlotCore<T> {
  /**
   * Contribute an entry to a slot.
   *
   * Shadowing: entries sharing one cell (no `key` — the slot itself; same
   * `key` — that keyed cell) coexist at distinct priorities, sorted ascending
   * with ties keeping registration order; the cell's lowest live entry
   * renders. A second registration in an occupied cell at the exact same
   * priority (default 0) throws naming slot, key, and priority, so
   * priority-less composition keeps a one-occupant-per-cell fail-loud.
   *
   * @param slotId - target slot id (materialized on first touch).
   * @param entry - opaque registrant payload handed back by reads verbatim.
   * @param options - cell shape: keyed `key`; shadowing `priority`.
   * @returns disposer removing the contribution and notifying subscribers
   * (idempotent; calling a stale disposer again is a no-op).
   */
  register(slotId: string, entry: T, options?: SlotRegistrationOptions): () => void
  /**
   * Project a slot's visible entries: the first (lowest-priority) live entry
   * per occupied cell — no key: one winner per cell across the whole slot;
   * with `key`: only that cell's winner. Shadowed entries never appear.
   * Winners keep ledger order: priority ascending, ties in registration order.
   * Builds a fresh array per call.
   * @param slotId - target slot id.
   * @param key - restrict the projection to one keyed cell.
   * @returns winning entry per addressed cell (empty when nothing occupies it).
   */
  entriesOf(slotId: string, key?: string): readonly RegisteredSlotEntry<T>[]
  /**
   * Current winner of the addressed view: head of {@link SlotCore.entriesOf}.
   * @param slotId - target slot id.
   * @param key - resolve one keyed cell instead of the whole slot.
   * @returns the lowest-priority live entry of the addressed cell(s), or
   * undefined while empty.
   */
  resolveSlot(slotId: string, key?: string): RegisteredSlotEntry<T> | undefined
  /**
   * Subscribe to mutations across every slot. The listener fires synchronously
   * AFTER a mutation commits (register insert or dispose removal), once per
   * mutation, with the changed slot id. Listener-set iteration snapshots
   * before calling, so registering/disposing from inside a listener is safe.
   * @param listener - change callback.
   * @returns unsubscribe (idempotent).
   */
  subscribe(listener: SlotChangeListener): () => void
}

/**
 * Create an empty priority-slot registry.
 * @typeparam T - registrant payload type shared by every slot in this core.
 * @returns a fresh, independent core instance.
 */
export function createSlotCore<T = unknown>(): SlotCore<T> {
  const records = new Map<string, SlotRecord<T>>()
  const listeners = new Set<SlotChangeListener>()

  const notify = (slotId: string): void => {
    // Snapshot before iterating: a listener may mutate the set reentrantly.
    for (const listener of [...listeners]) listener(slotId)
  }

  const recordOf = (slotId: string): SlotRecord<T> => {
    let record = records.get(slotId)
    if (!record) {
      record = { rows: [] }
      records.set(slotId, record)
    }
    return record
  }

  const assertCellFree = (
    slotId: string,
    rows: readonly RegisteredSlotEntry<T>[],
    key: string | undefined,
    priority: number,
  ): void => {
    const occupant = rows.find(row => row.key === key && row.priority === priority)
    if (!occupant) return
    const where = key === undefined
      ? `single slot "${slotId}" already has a registration`
      : `keyed slot "${slotId}" already has an entry for key "${key}"`
    throw new Error(
      `${where} at priority ${priority}`
      + ' — register at a different priority to shadow it (lowest renders)',
    )
  }

  const entriesOf = (slotId: string, key?: string): readonly RegisteredSlotEntry<T>[] => {
    const record = records.get(slotId)
    if (!record) return EMPTY_ROWS as readonly RegisteredSlotEntry<T>[]
    const heads: RegisteredSlotEntry<T>[] = []
    const seenCells = new Set<string | undefined>()
    for (const row of record.rows) {
      if (key !== undefined && row.key !== key) continue
      // Keyless rows share the one implicit cell (undefined), like upstream.
      if (seenCells.has(row.key)) continue
      seenCells.add(row.key)
      heads.push(row)
    }
    return Object.freeze(heads)
  }

  return {
    register(slotId, entry, options) {
      const priority = options?.priority ?? 0
      const key = options?.key
      const record = recordOf(slotId)
      assertCellFree(slotId, record.rows, key, priority)
      const row: RegisteredSlotEntry<T> = { entry, priority, key }
      // Insert after every row of equal-or-lower priority: ascending order and
      // tie stability hold by construction (no reliance on engine sort stability).
      let at = record.rows.length
      while (at > 0 && record.rows[at - 1].priority > priority) at -= 1
      record.rows.splice(at, 0, row)
      notify(slotId)
      return () => {
        if (!record.rows.includes(row)) return
        record.rows = record.rows.filter(live => live !== row)
        notify(slotId)
      }
    },

    entriesOf,

    resolveSlot(slotId, key) {
      return entriesOf(slotId, key)[0]
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
