/**
 * 插件：ui-frame
 * inject: ['dsh', 'sessions'] / provide: 'plugin-updater'
 *
 * 整屏框架壳：顶栏(左☰/标题+连接状态/右⚙) + 主内容区(body cell 胜出者) +
 * 左右抽屉(按抽屉槽位 keyed cell 渲染胜出者)。顶栏职责从 ui-chat 移交到本插件,
 * ui-chat 只保留对话本体。
 *
 * plugin-updater:manifest 驱动的远端插件装配。壳启动后调用 checkUpdates():
 * 读 `${base}/manifest.json`,把配置名单(plugins)内的变更逐行同步进 roster
 * (新增 / rev 换版),装配器照常完成注册装卸。失败只记日志不抛(现有容错哲学)。
 */
import React, { useEffect, useReducer, useState, useSyncExternalStore } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import type { RegisteredSlotEntry, SlotCore } from '@twibot/face-priority-slot'

import type { CordisPlugin } from '@twibot/face-cordis-kernel'
import type { RosterStore } from '../roster'
import { theme } from '../theme'
import {
  DRAWER_LEFT,
  DRAWER_RIGHT,
  DRAWER_SLOT,
  MAIN_BODY_KEY,
  MAIN_SLOT,
  type SessionsService,
} from '../types'
import type { ChatScreenEntry } from './chat-ui'

/** 设备组合层常量:Metro 兼职服务的插件静态目录(manifest + *.client.js)。 */
const DEFAULT_PLUGIN_BASE = 'http://metro.dsh.port.dpdns.org/plugins'

/** plugin-updater 服务契约(供 drawer-settings 与壳读取)。 */
export interface PluginSummary {
  id: string
  rev: string | null
  status: 'local' | 'remote' | 'error'
}

export interface PluginUpdater {
  /** 当前清单快照:id、rev(远端 chunk 的 sha1-12;本地无 rev 为 null)、status */
  listPlugins(): PluginSummary[]
  /** 重读 manifest 并把配置名单内的变更装配进 roster(新增/换版);返回本次生效变更数;失败记日志不抛 */
  checkUpdates(): Promise<number>
}

/** ui-frame 插件配置:关注名单 + manifest/chunk 服务根地址。 */
export interface FrameConfig {
  /** 本壳关注的远端插件 id 名单(与 manifest 求交集后才装配)。 */
  plugins: string[]
  /** manifest/chunk 服务根地址;缺省设备组合层常量。 */
  base?: string
}

/** 工厂可见的环境面:槽核心 + 插件清单(新增)。 */
interface FrameEnv {
  slots: SlotCore<unknown>
  roster: RosterStore
}

export function framePlugin(env: FrameEnv): CordisPlugin {
  const { slots, roster } = env
  return {
    name: 'ui-frame',
    inject: ['dsh', 'sessions'],
    apply(ctx, rawConfig) {
      const config = (rawConfig ?? {}) as Partial<FrameConfig>
      const plugins = Array.isArray(config.plugins) ? config.plugins : []
      const base =
        typeof config.base === 'string' && config.base !== ''
          ? config.base
          : DEFAULT_PLUGIN_BASE
      const sessions = ctx.sessions as SessionsService

      // ---- plugin-updater:manifest 驱动的远端插件装配 ----

      /** 配置名单 → 当前 roster 快照(缺失行视为本地模块)。 */
      const listPlugins = (): PluginSummary[] => {
        const rows = roster.get()
        return plugins.map((id) => {
          const row = rows.find((entry) => entry.id === id)
          if (!row) return { id, rev: null, status: 'local' }
          return {
            id,
            rev: row.remote?.rev ?? null,
            status: row.remote ? 'remote' : 'local',
          }
        })
      }

      const checkUpdates = async (): Promise<number> => {
        let manifest: { entries?: Array<{ id?: unknown; url?: unknown; rev?: unknown }> }
        try {
          const response = await fetch(`${base}/manifest.json`)
          if (!response.ok) {
            console.warn(`[ui-frame] manifest ${base}/manifest.json -> HTTP ${response.status}`)
            return 0
          }
          manifest = (await response.json()) as typeof manifest
        } catch (cause) {
          console.warn(
            `[ui-frame] 清单不可用,跳过更新(${cause instanceof Error ? cause.message : String(cause)})`,
          )
          return 0
        }

        const entries = (manifest.entries ?? []).filter(
          (entry): entry is { id: string; url: string; rev: string } =>
            typeof entry?.id === 'string' &&
            typeof entry?.url === 'string' &&
            typeof entry?.rev === 'string',
        )

        let changed = 0
        for (const entry of entries) {
          if (!plugins.includes(entry.id)) continue
          const url = `${base}/${entry.id}.client.js?rev=${entry.rev}`
          try {
            const existing = roster.get().find((row) => row.id === entry.id)
            if (!existing) {
              roster.add({ id: entry.id, module: entry.id, remote: { url, rev: entry.rev } })
              changed += 1
            } else if (existing.remote?.rev !== entry.rev) {
              // rev 变化 = 换版:删旧行再装新行(同一 id,装配器按 remote 行再同步)。
              roster.remove(entry.id)
              // 让出至少一个宏任务:kernel 的 registry.delete 是急切移除、fiber
              // 卸载是异步链;不等待就直接装新行可能撞上"同 cell 同 priority 已占用"
              // (slot 注册冲突)。让一拍后重试窗口显著缩小;即便偶发失败,下次
              // checkUpdates 会按"缺失行"路径重新补装,自愈。
              await new Promise<void>((resolve) => setTimeout(resolve, 0))
              roster.add({ id: entry.id, module: entry.id, remote: { url, rev: entry.rev } })
              changed += 1
            }
          } catch (cause) {
            // 冲突(add 抛错,如同 module 已挂)只记日志不断链,下轮更新再试。
            console.warn(
              `[ui-frame] 装配 ${entry.id} 失败:${cause instanceof Error ? cause.message : String(cause)}`,
            )
          }
        }
        return changed
      }

      ctx.provide('plugin-updater', { listPlugins, checkUpdates })
      // 工厂闭包捕获服务实例与槽核心;卸载 = 注销 = 界面消失(注册即效果)。
      const Frame = createFrame(slots as SlotCore<ChatScreenEntry>, sessions)
      ctx.effect(
        () => slots.register(MAIN_SLOT, { component: Frame }, { priority: -10 }),
        'ui-frame.slot(main)',
      )
    },
  }
}

// ---- 整屏框架 ----

function createFrame(slots: SlotCore<ChatScreenEntry>, sessions: SessionsService) {
  return function Frame() {
    // slot 注册表变更即重渲染(body / 抽屉胜出者变化)。
    const [, force] = useReducer((count: number) => count + 1, 0)
    useEffect(() => slots.subscribe(() => force()), [slots])
    const state = useSyncExternalStore(sessions.subscribe, () => sessions.state)
    const [drawer, setDrawer] = useState<'left' | 'right' | null>(null)

    const bodyEntry = slots.resolveSlot(MAIN_SLOT, MAIN_BODY_KEY)
    const leftEntry = slots.resolveSlot(DRAWER_SLOT, DRAWER_LEFT)
    const rightEntry = slots.resolveSlot(DRAWER_SLOT, DRAWER_RIGHT)

    const statusText = state.connected ? '已连接' : state.sessionId ? '连接中…' : '未连接'
    const statusColor = state.connected ? theme.colors.success : theme.colors.error

    return (
      <View style={styles.root}>
        {/* 顶栏:左抽屉 / 标题+连接状态 / 右抽屉 */}
        <View style={styles.topBar}>
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={() => setDrawer('left')}
            accessibilityLabel="会话列表"
          >
            <Text style={styles.iconText}>☰</Text>
          </TouchableOpacity>
          <View style={styles.titleBlock}>
            <Text style={styles.title}>Cordis Face</Text>
            <View style={styles.statusRow}>
              <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
              <Text style={styles.statusText}>{statusText}</Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={() => setDrawer('right')}
            accessibilityLabel="设置"
          >
            <Text style={styles.iconText}>⚙</Text>
          </TouchableOpacity>
        </View>

        {/* 主内容区:body cell 胜出者(ui-chat 注册于此) */}
        <View style={styles.body}>
          {bodyEntry === undefined ? (
            <Text style={styles.placeholder}>主内容区暂无插件</Text>
          ) : (
            <EntryView entry={bodyEntry} />
          )}
        </View>

        {/* 抽屉:只渲染当前打开的侧(side panel + 全屏 scrim) */}
        {drawer === 'left' && (
          <DrawerPanel side="left" onClose={() => setDrawer(null)} entry={leftEntry} />
        )}
        {drawer === 'right' && (
          <DrawerPanel side="right" onClose={() => setDrawer(null)} entry={rightEntry} />
        )}
      </View>
    )
  }
}

/** 渲染 slot 胜出者的 payload 组件(chunk 产物经 env.React.createElement,实例同源)。 */
function EntryView({ entry }: { entry: RegisteredSlotEntry<ChatScreenEntry> }) {
  const Component = entry.entry.component as React.ComponentType
  return <Component />
}

function DrawerPanel({
  side,
  onClose,
  entry,
}: {
  side: 'left' | 'right'
  onClose: () => void
  entry: RegisteredSlotEntry<ChatScreenEntry> | undefined
}) {
  return (
    <>
      <TouchableOpacity style={styles.scrim} onPress={onClose} accessibilityLabel="关闭抽屉" />
      <View style={[styles.panel, side === 'left' ? styles.panelLeft : styles.panelRight]}>
        <View style={styles.panelHeader}>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose} accessibilityLabel="关闭">
            <Text style={styles.closeText}>✕</Text>
          </TouchableOpacity>
        </View>
        {entry === undefined ? (
          <Text style={styles.placeholder}>该侧栏暂无插件抽屉</Text>
        ) : (
          <EntryView entry={entry} />
        )}
      </View>
    </>
  )
}

// ---- 样式(全部出自 theme 令牌)----

const s = theme.spacing

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s.sm,
    paddingHorizontal: s.md,
    paddingTop: s.xl,
    paddingBottom: s.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  iconBtn: { minWidth: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  iconText: { color: theme.colors.textPrimary, fontSize: theme.fontSize.lg },
  titleBlock: { flex: 1, alignItems: 'center' },
  title: { color: theme.colors.textPrimary, fontSize: theme.fontSize.lg, fontWeight: '700' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { color: theme.colors.textSecondary, fontSize: theme.fontSize.xs },
  body: { flex: 1 },
  placeholder: {
    color: theme.colors.textSecondary,
    fontSize: theme.fontSize.sm,
    textAlign: 'center',
    paddingTop: s.xl,
  },
  scrim: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  panel: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: '78%',
    backgroundColor: theme.colors.surface,
    padding: s.md,
  },
  panelLeft: {
    left: 0,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: theme.colors.border,
  },
  panelRight: {
    right: 0,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: theme.colors.border,
  },
  panelHeader: { alignItems: 'flex-end', marginBottom: s.sm },
  closeBtn: { minWidth: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  closeText: { color: theme.colors.textPrimary, fontSize: theme.fontSize.lg },
})