/**
 * P1 组装入口:壳 = slot 核心 + 空 Context + roster 清单 + 装配器。
 *
 * 壳不再认识任何具体插件:boot 读默认清单建 RosterStore,装配器把
 * "清单 ↔ cordis registry"持续对齐——启动时装满,此后每次增删行都增量同步,
 * effect 逆序回滚,不留尸。北极星对位:P2 把清单来源换成后台 inventory,
 * 装配器与插件全部原样复用。
 */
import * as React from 'react'
import * as ReactNative from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as jsxRuntime from 'react/jsx-runtime'

import { Context } from '@twibot/face-cordis-kernel'
import { createSlotCore } from '@twibot/face-priority-slot'

import type { CordisPlugin } from '@twibot/face-cordis-kernel'
import { fetchInventoryViaBootPage, ensureChunkLoaded } from './script-loader'
import type { ChatScreenEntry } from './plugins/chat-ui'
import { resolveModule, type ModuleEnv } from './modules'
import {
  composeRoster,
  createRosterStore,
  defaultRoster,
  type RosterEntry,
  type RosterStore,
} from './roster'

export type { RosterEntry, RosterStore } from './roster'
export { MAIN_SLOT } from './types'

export interface Shell {
  /** 装配完成的根上下文。 */
  ctx: Context
  /** 主槽位注册表:宿主据此渲染胜出的 UI 组件。 */
  slots: ReturnType<typeof createSlotCore<ChatScreenEntry>>
  /** 插件清单:增删行即实时装卸对应能力。 */
  roster: RosterStore
  /** 宿主注入面:远端 chunk 求值/装载都要它(plugin-sync 预热 chunk 用)。 */
  env: ModuleEnv
}

/**
 * 启动整棵插件树。
 * @param baseUrl dsh 宿主绝对地址(公网域名,如 http://admin.dsh.port.dpdns.org)。
 * @param opts.bindings 宿主条目名 → 本地模块键的兴趣绑定;P2.2 远端 chunk 就绪前默认为空。
 */
export async function boot(
  baseUrl: string,
  opts?: { bindings?: Record<string, string> },
): Promise<Shell> {
  const slots = createSlotCore<ChatScreenEntry>()
  const ctx = new Context()

  // ---- P2:清单来源 = 宿主 __DSH_BOOT__ 图谱(现状契约)∩ 本地模块表;失败回退本地基线 ----
  let initial = defaultRoster(baseUrl)
  try {
    const rows = await fetchInventoryViaBootPage(baseUrl)
    const composed = composeRoster({
      baseUrl,
      inventory: rows.map((row) => ({
        moduleName: row.id,
        enabled: true,
        url: row.url,
        rev: row.rev,
      })),
      bindings: opts?.bindings ?? {},
    })
    if (composed.deferred.length > 0) {
      console.info(
        `[roster] 远端 chunk 候补 ${composed.deferred.length} 个(宿主图谱已知、本地未绑定)`,
      )
    }
    initial = composed.entries
  } catch (cause) {
    console.warn(
      `[roster] 清单不可用,回退本地基线(${cause instanceof Error ? cause.message : String(cause)})`,
    )
  }
  // env 需要 roster(plugin-updater 经它装配远端行),故清单在环境之前就位。
  const roster = createRosterStore(initial)

  const env: ModuleEnv = {
    slots,
    React,
    ReactNative: ReactNative as unknown,
    roster,
    AsyncStorage,
    jsxRuntime,
  }

  // ---- 装配器:让 registry 持续等于清单的投影 ----

  const installed = new Map<string, CordisPlugin>()

  /**
   * 单行清单 → 插件对象。remote 行先经 chunk 通道下载执行(Hermes 的
   * new Function 或原生 ScriptLoader),从全局挂载面取回工厂;其余走本地模块表。
   */
  async function materializePlugin(entry: RosterEntry): Promise<CordisPlugin> {
    if (entry.remote === undefined) {
      return resolveModule(entry.module)(env)
    }
    const mount = await ensureChunkLoaded(entry.module, entry.remote, env)
    const made = mount.mount(env as unknown as Record<string, unknown>) as CordisPlugin
    if (typeof made?.apply !== 'function') {
      throw new Error(`remote-chunk: "${entry.module}".mount() did not return a cordis plugin shape`)
    }
    return made
  }

  async function sync(): Promise<void> {
    const desired = roster.get()
    // 卸载:逆安装序,给级联回滚留整洁路径。
    for (const id of [...installed.keys()].reverse()) {
      if (desired.some((entry) => entry.id === id)) continue
      ctx.registry.delete(installed.get(id)!)
      installed.delete(id)
    }
    // 安装:按清单顺序(cordis inject 自会等待依赖服务就绪)。
    for (const entry of desired) {
      if (installed.has(entry.id)) continue
      const plugin = await materializePlugin(entry)
      await ctx.plugin(plugin, entry.config as Record<string, unknown> | undefined)
      installed.set(entry.id, plugin)
    }
  }

  // 失败只记日志不断链:队列保持 resolved,后续增删仍可收敛;
  // 初始安装不走这里——boot 直接 await,装配失败即启动失败(大声失败)。
  let queue: Promise<void> = sync()
  roster.subscribe(() => {
    queue = queue.then(sync).catch((reason: unknown) => {
      console.error('[roster] 同步失败:', reason)
    })
  })
  await queue

  return { ctx, slots, roster, env }
}
