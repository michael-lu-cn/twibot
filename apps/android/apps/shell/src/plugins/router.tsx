/**
 * 插件：ui-router（组合路由 + App 壳 + nav 服务）
 * - 未配置 cookie → 认证设置全屏；已配置 → AppShell（底部 tab 五屏）常驻。
 * - AppShell 内部导航由 navStore 驱动：tab 切换 / 用户主页覆层 / 返回原 tab。
 * - provide `nav` 服务（壳可经 ctx.nav 处理深链 twibot://bookmarks|users/<handle>）。
 * - 切换 = 注销旧 slot 条目 + 注册新条目（注册即效果，卸载即回滚）。
 */
import React, { useMemo, useSyncExternalStore } from 'react'
import { StyleSheet, View } from 'react-native'
import type { CordisPlugin } from '@twibot/face-cordis-kernel'
import type { SlotCore } from '@twibot/face-priority-slot'
import { createStore } from 'zustand/vanilla'

import { createApiClient, isOk } from '../lib/api-client'
import { deepLinkToPath, parseRoutePath, type Route } from '../lib/router'
import { MAIN_BODY_KEY, MAIN_SLOT } from '../types'
import { TabBar, type AppTab } from '../components/tab-bar'
import { createAuthScreen } from '../screens/auth'
import { createFeedScreen } from '../screens/feed'
import { createFollowingScreen } from '../screens/following'
import { createGroupsScreen } from '../screens/groups'
import { createBookmarksScreen } from '../screens/bookmarks'
import { createUserScreen } from '../screens/user'
import { createSettingsScreen } from '../screens/settings'

/** 本插件向 slot 注册的载荷。 */
export interface ScreenEntry {
  component: React.ComponentType
}

/** nav 服务面（壳与外部联动用）。 */
export interface NavService {
  openTab(tab: AppTab): void
  openUser(handle: string): void
  /** 打开认证屏覆层（设置页「重新粘贴 Cookie」）。 */
  openAuth(): void
  /** 关闭认证屏覆层，回到原内容。 */
  closeAuth(): void
  back(): void
  /** 深链 → 路由动作（twibot://bookmarks、twibot://users/foo）。 */
  openDeepLink(url: string): void
}

interface NavState {
  tab: AppTab
  lastTab: AppTab
  /** 非空 = 用户主页覆层全屏。 */
  userHandle: string | null
  /** true = 认证屏覆层全屏（从设置页进入）。 */
  authOpen: boolean
}

export function routerPlugin(slots: SlotCore<unknown>): CordisPlugin {
  return {
    name: 'ui-router',
    apply(ctx, config) {
      const baseUrl = String((config as { baseUrl?: string } | undefined)?.baseUrl ?? 'http://10.0.2.2:12000')
      const api = createApiClient(baseUrl)
      let dispose: (() => void) | null = null

      // ---- navStore：AppShell 内部导航状态（模块级，AppShell 与 nav 共享）----
      const navStore = createStore<NavState>()(() => ({
        tab: 'home',
        lastTab: 'home',
        userHandle: null,
        authOpen: false,
      }))

      const nav: NavService = {
        openTab(tab) {
          navStore.setState({ tab, lastTab: tab, userHandle: null, authOpen: false })
        },
        openUser(handle) {
          navStore.setState((s) => ({ ...s, lastTab: s.tab, userHandle: handle, authOpen: false }))
        },
        openAuth() {
          navStore.setState((s) => ({ ...s, authOpen: true }))
        },
        closeAuth() {
          navStore.setState((s) => ({ ...s, authOpen: false }))
        },
        back() {
          navStore.setState((s) => ({ ...s, userHandle: null, tab: s.lastTab }))
        },
        openDeepLink(url) {
          const path = deepLinkToPath(url)
          if (!path) return
          const route: Route = parseRoutePath(path)
          if (route.userHandle) nav.openUser(route.userHandle)
          else if (route.tab === 'auth') nav.openAuth()
          else nav.openTab(route.tab)
        },
      }

      // ---- AppShell：常驻容器，内部状态全走 navStore ----
      const makeAppShell = () =>
        function AppShell() {
          const state = useSyncExternalStore(
            (cb) => navStore.subscribe(cb),
            () => navStore.getState(),
          )
          const { tab, userHandle, authOpen } = state
          // hooks 必须在任何条件早返回之前：useMemo 恒调用（覆层时仅构造元素，不渲染）。
          const content = useMemo(() => {
            switch (tab) {
              case 'home': {
                const C = createFeedScreen({ api, onOpenUser: (h) => nav.openUser(h) })
                return <C />
              }
              case 'following': {
                const C = createFollowingScreen({ api, onOpenUser: (h) => nav.openUser(h) })
                return <C />
              }
              case 'groups': {
                const C = createGroupsScreen({ api, onOpenUser: (h) => nav.openUser(h) })
                return <C />
              }
              case 'bookmarks': {
                const C = createBookmarksScreen({ api, onOpenUser: (h) => nav.openUser(h) })
                return <C />
              }
              case 'settings': {
                const C = createSettingsScreen({ api, onOpenAuth: () => nav.openAuth() })
                return <C />
              }
            }
            // eslint-disable-next-line react-hooks/exhaustive-deps
          }, [tab, userHandle])

          // 认证屏覆层（从设置页进入；保存成功回主页，返回键回设置页）
          if (authOpen) {
            const C = createAuthScreen({
              api,
              onAuthChanged: () => nav.openTab('home'),
              onBack: () => nav.closeAuth(),
            })
            return <C />
          }

          // 用户主页覆层（全屏，无 tab）
          if (userHandle) {
            const C = createUserScreen({
              handle: userHandle,
              api,
              onBack: () => nav.back(),
              onOpenUser: (h) => nav.openUser(h),
            })
            return <C />
          }

          return (
            <View style={styles.shell}>
              <View style={styles.body}>{content}</View>
              <TabBar active={tab} onSelect={(t) => nav.openTab(t)} />
            </View>
          )
        }

      const AppShell = makeAppShell()

      const mount = (screen: React.ComponentType) => {
        dispose?.()
        dispose = slots.register(MAIN_SLOT, { component: screen } satisfies ScreenEntry, { key: MAIN_BODY_KEY })
      }

      /** 初始装配：凭据已配置 → AppShell；否则 → 认证设置全屏。 */
      const resolveInitial = () => {
        void (async () => {
          const r = await api.credentialStatus()
          if (isOk(r) && r.data.configured) {
            mount(AppShell)
          } else {
            mount(createAuthScreen({ api, onAuthChanged: () => void resolveInitial() }))
          }
        })()
      }

      ctx.provide('nav', nav)

      ctx.effect(
        () => {
          resolveInitial()
          return () => {
            dispose?.()
            dispose = null
          }
        },
        'ui-router.main/body',
      )
    },
  }
}

const styles = StyleSheet.create({
  shell: { flex: 1 },
  body: { flex: 1 },
})