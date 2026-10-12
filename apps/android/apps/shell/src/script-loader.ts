/**
 * P2.2 远端 chunk 装载器:按 (module, url, rev) 取回并执行插件脚本。
 *
 * 执行通道刻意统一为「fetch 文本 + new Function 求值」:
 * - 设备(Hermes)与 Node 档走同一条已测代码路径;
 * - Repack 5.3 已把 ScriptManager 内部化(包导出面不再暴露),原生装载通道
 *   待其重新公开或自建桥接时再启用;届时两条通道仍汇合同一 __face_plugins。
 *
 * 依赖面:chunk 里的 bare import 由宿主注入面满足(见 chunk-registry 的 ChunkEnv),
 * 故求值时要一并传入 env;缓存的是"挂载面"(env 无关),装载时仍按次传 env。
 *
 * 缓存语义("带缓存的客户端"的最小实现):
 * - 内存 Map 以 `${url}@${rev}` 为键;命中即跳过网络(rev 未变不重复下载);
 * - rev 变化 = 新键 = 自然失效重拉;
 * - 可选持久化存储(AsyncStorage 兼容面):内存未命中先查存储,冷启动命中
 *   即跳过网络;取回成功后异步写回。存储读写故障全部回退网络/仅内存
 *   (服务端是真相源,持久化只省流量;陈旧键由 rev 变更自然废弃,清理属 P3)。
 */
import {
  evalChunkCode,
  getRemoteMount,
  type ChunkEnv,
  type RemotePluginMount,
} from './chunk-registry'

export interface RemoteChunkRef {
  url: string
  rev: string
}

/**
 * 持久化存储的极简面:AsyncStorage 兼容子集(getItem/setItem)。
 * 装配见 {@link setChunkStore};Node 档测试注入内存实现。
 */
export interface ChunkStore {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
}

const memoryCache = new Map<string, RemotePluginMount>()
/** 测试观测点:真实发生的网络取回次数。 */
let fetchCount = 0
let chunkStore: ChunkStore | null = null

async function fetchChunkCode(urlWithRev: string): Promise<string> {
  fetchCount += 1
  const response = await fetch(urlWithRev)
  if (!response.ok) {
    throw new Error(`remote-chunk: fetch ${urlWithRev} -> HTTP ${response.status}`)
  }
  return response.text()
}

/**
 * 装配持久化 chunk 缓存;传 null 恢复纯内存模式(默认)。
 * 设备档在 App.tsx 装配 AsyncStorage;Node 档测试注入内存实现。
 */
export function setChunkStore(store: ChunkStore | null): void {
  chunkStore = store
}

/** 读持久化码源;存储故障视为未命中(回退网络,不阻断)。 */
async function readPersistedCode(key: string): Promise<string | null> {
  const store = chunkStore
  if (store === null) return null
  try {
    return await store.getItem(key)
  } catch (cause) {
    console.warn(
      `[chunk-cache] 读取失败,回退网络(${cause instanceof Error ? cause.message : String(cause)})`,
    )
    return null
  }
}

/** 写持久化码源;存储故障只记日志,本次挂载不受影响。 */
async function persistCode(key: string, code: string): Promise<void> {
  const store = chunkStore
  if (store === null) return
  try {
    await store.setItem(key, code)
  } catch (cause) {
    console.warn(
      `[chunk-cache] 写入失败,仅内存缓存(${cause instanceof Error ? cause.message : String(cause)})`,
    )
  }
}

/**
 * 确保 chunk 已执行并返回其挂载面。
 * @param module - chunk 必须注册的名字(`__face_plugins[module]`)。
 * @param ref - 远端 chunk 的 url 与内容修订。
 * @param env - 宿主注入面(chunk 里 `require('react')` 等落到它;缺它则只能在
 *   不 import 任何东西的纯脚本 chunk 上工作)。
 * @throws {Error} 网络失败、HTTP 非 2xx、或求值后未注册 —— 全部大声失败。
 */
export async function ensureChunkLoaded(
  module: string,
  ref: RemoteChunkRef,
  env?: ChunkEnv,
): Promise<RemotePluginMount> {
  const key = `${ref.url}@${ref.rev}`
  const cached = memoryCache.get(key)
  if (cached !== undefined) return cached

  // chunk 内可见的当前修订(演示/诊断用;正式 API 走 mount(env))。
  ;(globalThis as Record<string, unknown>)['__face_rev'] = ref.rev

  const stored = await readPersistedCode(key)
  if (stored !== null) {
    const mounted = evalChunkCode(module, stored, env)
    memoryCache.set(key, mounted)
    return mounted
  }

  const urlWithRev = `${ref.url}${ref.url.includes('?') ? '&' : '?'}rev=${encodeURIComponent(ref.rev)}`
  const code = await fetchChunkCode(urlWithRev)
  const mounted = evalChunkCode(module, code, env)
  memoryCache.set(key, mounted)
  void persistCode(key, code)
  return mounted
}

/** 兼容旧引用:未注册时的显式读取(可能为 undefined)。 */
export { getRemoteMount }

/** 仅供测试:当前进程内的网络取回次数。 */
export function chunkFetchCountForTests(): number {
  return fetchCount
}

/** 仅供测试:清空内存缓存、持久化装配与全局注册表。 */
export function resetChunkCacheForTests(): void {
  memoryCache.clear()
  delete globalThis.__face_plugins
  fetchCount = 0
  chunkStore = null
}

// ---- 现状宿主的清单契约:index 页 __DSH_BOOT__ 全局 ----

/** __DSH_BOOT__ 图谱里一行的客户端可见子集。 */
export interface BundleRow {
  id: string
  /** 服务地址,形如 /plugins/<id>/client.js?rev=<sha1-12>(rev 即缓存锚点)。 */
  url: string
  rev: string
}

/**
 * 从宿主 index HTML 解析 __DSH_BOOT__ 清单 —— 现状宿主自带的稳定清单契约,
 * 无需任何宿主侧改动。解析失败或无图谱返回空数组(调用方自行回退)。
 */
export async function fetchInventoryViaBootPage(baseUrl: string): Promise<BundleRow[]> {
  const html = await fetch(baseUrl).then((r) => r.text())
  // 宿主注入格式:<script>globalThis["__DSH_BOOT__"] = {...}</script>
  // (JSON 内 '<' 被转义为 \u003c,故 JSON.parse 直接可用;不能对 '}' 懒匹配)
  const m = html.match(/globalThis\["__DSH_BOOT__"\]\s*=\s*([\s\S]*?)<\/script>/)
  if (!m) return []
  try {
    const graph = JSON.parse(m[1]) as { entries?: Array<{ id?: unknown; url?: unknown; rev?: unknown }> }
    return (graph.entries ?? [])
      .filter((row) => typeof row?.id === 'string' && typeof row?.url === 'string' && typeof row?.rev === 'string')
      .map((row) => ({ id: row.id as string, url: row.url as string, rev: row.rev as string }))
  } catch {
    return []
  }
}
