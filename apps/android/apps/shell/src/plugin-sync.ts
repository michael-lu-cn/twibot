/**
 * P2.2/P2.3 宿主清单 → roster 的远端化同步(壳内核侧)。
 *
 * 壳内核只做两件事:boot 时装本地基线,随后**持续**把宿主的插件清单收敛进
 * roster —— 清单里有的能力换成远端 chunk 实现,清单里撤掉的回退本地实现。
 * 于是"改插件"的闭环是:改源码 → 重建 chunk(rev 变)→ 壳拉到新 rev →
 * 卸旧装新,**不重装 APK、不用 Metropackager**。
 *
 * 取舍与边界:
 * - 只认 {@link MODULE_KEYS}(本地模块表已有实现的能力)。清单是数据,但
 *   "壳会执行哪些 id"仍是信任边界,名单外的行忽略并记账(不静默)。
 * - 换行前先 {@link ensureChunkLoaded} 预热:下载/求值失败就**保留现状**
 *   (本地实现继续跑),绝不把界面换成一个装不上的空白。
 * - 远端 chunk 是代码执行通道,服务端是信任域:只接自己的宿主(见 README 拓扑)。
 */
import { MODULE_KEYS } from './modules'
import type { Shell } from './index'
import { defaultRoster } from './roster'
import { ensureChunkLoaded } from './script-loader'

/** 清单里的一行(chunk-server 的 manifest.json 契约)。 */
export interface ManifestEntry {
  id: string
  /** 可绝对、也可相对宿主根(如 `/plugins/ui-router.client.js`)。 */
  url: string
  /** 内容修订(sha1-12);变即换版。 */
  rev: string
}

export interface SyncResult {
  /** 本次换成远端实现(或换到新 rev)的 id。 */
  changed: string[]
  /** 清单撤掉、回退成本地实现的 id。 */
  restored: string[]
  /** 清单撤掉且本地无实现、直接卸载的 id。 */
  dropped: string[]
  /** 清单里有、但不在壳的信任名单里,被忽略的 id。 */
  skipped: string[]
  /** 预热失败(网络/求值)被跳过的 id;下次同步会再试。 */
  failed: string[]
}

/** 让出一拍:kernel 的 registry.delete 是急切移除、fiber 卸载是异步链。 */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/** 相对 URL 补成绝对(宿主可能只发 `/plugins/x.client.js`)。 */
function absoluteUrl(baseUrl: string, url: string): string {
  if (/^https?:\/\//i.test(url)) return url
  return `${baseUrl.replace(/\/+$/, '')}${url.startsWith('/') ? '' : '/'}${url}`
}

/**
 * 读宿主插件清单;宿主没有这条路由(404)、超时、或 JSON 不合法都返回空数组
 * —— "没有清单"是正常状态(壳继续跑本地基线),不是错误。
 */
export async function fetchPluginManifest(
  baseUrl: string,
  opts?: { path?: string; timeoutMs?: number; quiet?: boolean },
): Promise<ManifestEntry[]> {
  const path = opts?.path ?? '/plugins/manifest.json'
  const url = absoluteUrl(baseUrl, path)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts?.timeoutMs ?? 4000)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) {
      if (!opts?.quiet) console.info(`[plugin-sync] ${url} -> HTTP ${response.status},用本地基线`)
      return []
    }
    const body = (await response.json()) as { entries?: Array<Record<string, unknown>> }
    // 只收三字段齐全的行(契约见 chunk-server):残缺行忽略,不猜。
    return (body.entries ?? []).flatMap((row) => {
      const id = row?.['id']
      const url = row?.['url']
      const rev = row?.['rev']
      return typeof id === 'string' && typeof url === 'string' && typeof rev === 'string'
        ? [{ id, url, rev }]
        : []
    })
  } catch (cause) {
    if (!opts?.quiet) {
      console.info(
        `[plugin-sync] 清单不可用,用本地基线(${cause instanceof Error ? cause.message : String(cause)})`,
      )
    }
    return []
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 按清单收敛 roster:新增/换版的远端行,撤掉的行回退本地。
 * @param shell - boot 产物(需要 roster 与宿主注入面 env)。
 * @param baseUrl - 宿主根地址(相对 URL 的基准)。
 * @param opts.known - 信任名单;缺省 {@link MODULE_KEYS}。
 * @param opts.manifest - 直接注入清单(测试/预热用);缺省现场拉取。
 */
export async function syncRemotePlugins(
  shell: Shell,
  baseUrl: string,
  opts?: { known?: readonly string[]; manifest?: readonly ManifestEntry[] },
): Promise<SyncResult> {
  const known = new Set(opts?.known ?? MODULE_KEYS)
  const baseline = new Map(defaultRoster(baseUrl).map((row) => [row.id, row]))
  const result: SyncResult = { changed: [], restored: [], dropped: [], skipped: [], failed: [] }
  const manifest = opts?.manifest ?? (await fetchPluginManifest(baseUrl))

  for (const entry of manifest) {
    if (!known.has(entry.id)) {
      result.skipped.push(entry.id)
      continue
    }
    const url = absoluteUrl(baseUrl, entry.url)
    const current = shell.roster.get().find((row) => row.id === entry.id)
    if (current?.remote?.rev === entry.rev) continue // 已是目标版本

    // 预热:先下载+求值进缓存,失败就保留现状(本地实现继续可用)。
    try {
      await ensureChunkLoaded(entry.id, { url, rev: entry.rev }, shell.env)
    } catch (cause) {
      result.failed.push(entry.id)
      console.warn(
        `[plugin-sync] ${entry.id} 预热失败,保留现状(${cause instanceof Error ? cause.message : String(cause)})`,
      )
      continue
    }

    if (current !== undefined) {
      shell.roster.remove(entry.id)
      await tick()
    }
    shell.roster.add({
      id: entry.id,
      module: entry.id,
      // 远端行必须继承本地基线的 config:插件的 baseUrl 等参数来自 roster 行,
      // 漏掉它 ui-router 会退回默认的 10.0.2.2(只有模拟器能到)。
      config: baseline.get(entry.id)?.config ?? { baseUrl },
      remote: { url, rev: entry.rev },
    })
    result.changed.push(entry.id)
    console.log(
      `[plugin-sync] ${entry.id} ${current === undefined ? '本地 → 远端' : `rev ${current.remote?.rev ?? '?'} → ${entry.rev}`}`,
    )
  }

  // 清单撤掉的行:有本地实现就复原基线行,没有就整体卸载。
  for (const row of [...shell.roster.get()]) {
    if (row.remote === undefined) continue
    if (manifest.some((entry) => entry.id === row.id)) continue
    shell.roster.remove(row.id)
    const base = baseline.get(row.id)
    if (base === undefined) {
      result.dropped.push(row.id)
      console.log(`[plugin-sync] ${row.id} 远端 → 卸载`)
      continue
    }
    await tick()
    shell.roster.add(base)
    result.restored.push(row.id)
    console.log(`[plugin-sync] ${row.id} 远端 → 本地基线(清单已撤)`)
  }

  return result
}

/**
 * 起一个清单同步器:立即同步一次,此后按 `intervalMs` 轮询(0 = 只同步一次)。
 * @returns 停止函数(清定时器)。
 */
export function startPluginSync(
  shell: Shell,
  baseUrl: string,
  opts?: { intervalMs?: number; onResult?: (result: SyncResult) => void },
): () => void {
  const intervalMs = opts?.intervalMs ?? 15000
  let stopped = false
  const run = async (): Promise<void> => {
    if (stopped) return
    try {
      const result = await syncRemotePlugins(shell, baseUrl)
      opts?.onResult?.(result)
    } catch (cause) {
      // 同步失败只记日志:壳已经跑着本地基线,后续轮询会再收敛。
      console.warn(
        `[plugin-sync] 同步失败(${cause instanceof Error ? cause.message : String(cause)})`,
      )
    }
  }
  void run()
  if (intervalMs <= 0) return () => { stopped = true }
  const timer = setInterval(() => void run(), intervalMs)
  return () => {
    stopped = true
    clearInterval(timer)
  }
}
