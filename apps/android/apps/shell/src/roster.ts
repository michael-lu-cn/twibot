/**
 * P1 roster:插件清单即数据。
 *
 * 壳不再硬编码"装哪些插件"——boot 只认这里的一份条目列表;
 * 增删条目由 assembler 同步到 cordis registry(effect 回滚,不留尸)。
 * 北极星对位:P2 后台 inventory 下发的就是这份列表的运行时更新,
 * 届时来源从本地默认值换成 RPC 投影,客户端语义零变化。
 */
import { createStore } from 'zustand/vanilla'

/** 清单里的一行:装哪个模块、以什么身份、带什么配置。 */
export interface RosterEntry {
  /** 实例 id,清单内唯一;卸载与日志都以它为键。 */
  id: string
  /** 模块表键(P2 起为宿主下发的远端 chunk 名)。 */
  module: string
  /** 传给插件的 config,契约由各模块自定(如 dsh-connection 需要 baseUrl)。 */
  config?: unknown
  /**
   * 远端 chunk 引用(P2.2):存在时安装走"下载并执行脚本 → 取 __face_plugins
   * 挂载面",`module` 键同时是 chunk 必须注册的名字;缺省走本地模块表。
   */
  remote?: { url: string; rev: string }
}

interface RosterState {
  entries: RosterEntry[]
}

/** 可变插件清单;变更按提交顺序同步通知。 */
export interface RosterStore {
  /** 当前条目(只读快照,顺序即安装顺序)。 */
  get(): readonly RosterEntry[]
  /** 订阅变更(每次增删后同步触发)。 */
  subscribe(listener: () => void): () => void
  /** 追加一行;id 或 module 与现存行冲突立即抛错(误配大声失败)。 */
  add(entry: RosterEntry): void
  /** 按 id 移除一行;id 不存在时静默跳过(后台收敛可能重复下发删除)。 */
  remove(id: string): void
}

/** 创建可变清单,初始内容为 `entries` 的拷贝。 */
export function createRosterStore(entries: readonly RosterEntry[]): RosterStore {
  const store = createStore<RosterState>()(() => ({ entries: [...entries] }))
  const assertFree = (entry: RosterEntry) => {
    for (const existing of store.getState().entries) {
      if (existing.id === entry.id) {
        throw new Error(`roster: duplicate id "${entry.id}"`)
      }
      if (existing.module === entry.module) {
        throw new Error(
          `roster: module "${entry.module}" already mounted as "${existing.id}"` +
            ' — one live instance per module',
        )
      }
    }
  }
  return {
    get: () => store.getState().entries,
    subscribe: store.subscribe,
    add(entry) {
      assertFree(entry)
      store.setState((prev) => ({ entries: [...prev.entries, entry] }))
    },
    remove(id) {
      const rest = store.getState().entries.filter((entry) => entry.id !== id)
      if (rest.length === store.getState().entries.length) return
      store.setState({ entries: rest })
    },
  }
}

/**
 * 默认清单:P0.5 三插件的声明式写法。
 * 顺序即安装顺序(依赖方写在后方;cordis inject 也会等待,顺序是给人读的)。
 * 删掉任意一行并热重载,对应能力即从壳上消失——这是 P1 的验收动作。
 */
export function defaultRoster(baseUrl: string): RosterEntry[] {
  // twibot face：M1 组合路由（按凭据装配认证/推荐流/用户主页三屏）。
  return [
    { id: 'ui-router', module: 'ui-router', config: { baseUrl } },
    // P2.2 管线演示行不常驻基线:时钟面板走 Metro chunk,由设备组合层
    // (apps/shell/App.tsx 在 boot 后追加)。基线保持网络无关,Node 单测可离线跑;
    // 复演构建: bash scripts/build-chunk.sh clock-panel
    // { id: 'clock-panel', module: 'clock-panel', remote: { url: 'http://metro.dsh.port.dpdns.org/plugins/clock-panel.client.js', rev: '72879abd14f2' } },
    // 手写 IIFE 首验演示行(已验收 ✓;保留作对照):
    // { id: 'demo-panel', module: 'demo-panel', remote: { url: 'http://chunks.dsh.port.dpdns.org/demo-panel.client.js', rev: 'r2' } },
  ]
}

// ---- P2:宿主 inventory → roster 合成 ----

/** 宿主清单条目的最小结构面(protocol-client 的 PluginInventoryItem 子集)。 */
export interface InventoryItemLike {
  moduleName: string
  enabled: boolean
  url?: string
  rev?: string
}

export interface ComposedRoster {
  /** 进清单的行:基线 + 命中绑定的宿主条目。 */
  entries: RosterEntry[]
  /**
   * 携带 bundle(url/rev)但本地模块表没有对应实现的宿主条目——
   * P2.2 远端 chunk(ScriptManager)的候补名单;当前阶段仅记录不装载。
   */
  deferred: Array<{ moduleName: string; url?: string; rev?: string }>
}

/**
 * 宿主清单 → roster 行的合成策略:
 * 1. 基线:connection/session-store/ui-chat 永远在场(RN 本地实现);
 * 2. 绑定表:`宿主条目名 → 模块键`,enabled 条目命中即追加(配置可传);
 * 3. 其余携带 url/rev 的条目归入 deferred,等远端 chunk 通道就绪。
 */
export function composeRoster(input: {
  baseUrl: string
  inventory: readonly InventoryItemLike[]
  bindings?: Record<string, string>
}): ComposedRoster {
  const { baseUrl, inventory } = input
  const bindings = input.bindings ?? {}
  const entries = defaultRoster(baseUrl)
  const deferred: ComposedRoster['deferred'] = []
  for (const item of inventory) {
    if (item.moduleName === '') continue
    const boundModule = bindings[item.moduleName]
    if (boundModule !== undefined) {
      if (!item.enabled) continue
      entries.push({ id: item.moduleName, module: boundModule })
      continue
    }
    // 未绑定但带 bundle 信息 = 未来远端 chunk 的候补。
    if (item.url !== undefined || item.rev !== undefined) {
      deferred.push({ moduleName: item.moduleName, ...(item.url !== undefined ? { url: item.url } : {}), ...(item.rev !== undefined ? { rev: item.rev } : {}) })
    }
  }
  return { entries, deferred }
}
