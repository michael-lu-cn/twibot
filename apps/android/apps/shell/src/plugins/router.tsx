/**
 * 插件：ui-router（组合路由 + App 壳）
 * - 未配置 cookie → 认证设置全屏；已配置 → AppShell（底部 tab 五屏）。
 * - 书签/关注/分组/主页内点击作者 → UserScreen 全屏覆层；返回回到原 tab。
 * - 切换 = 注销旧 slot 条目 + 注册新条目（注册即效果，卸载即回滚）。
 */
import React, { useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import type { CordisPlugin } from '@twibot/face-cordis-kernel'
import type { SlotCore } from '@twibot/face-priority-slot'

import { createApiClient, isOk } from '../lib/api-client'
import { MAIN_BODY_KEY, MAIN_SLOT } from '../types'
import { TabBar, type AppTab } from '../components/tab-bar'
import { createAuthScreen } from '../screens/auth'
import { createFeedScreen } from '../screens/feed'
import { createFollowingScreen } from '../screens/following'
import { createGroupsScreen } from '../screens/groups'
import { createBookmarksScreen } from '../screens/bookmarks'
import { createUserScreen } from '../screens/user'

/** 本插件向 slot 注册的载荷。 */
export interface ScreenEntry {
  component: React.ComponentType
}

/** App 壳：底部 tab 容器，内容区按 tab 渲染对应屏。 */
function createAppShell(props: {
  api: ReturnType<typeof createApiClient>
  onOpenUser: (handle: string) => void
  initialTab: AppTab
  onTabChange: (t: AppTab) => void
}) {
  return function AppShell() {
    const { api, onOpenUser, initialTab, onTabChange } = props
    const [tab, setTab] = useState<AppTab>(initialTab)
    // 注意：必须经 JSX 渲染组件（<C />），直接调用组件函数会在 hooks 框架外执行 → 崩。
    const content = useMemo(() => {
      switch (tab) {
        case 'home': {
          const C = createFeedScreen({ api, onOpenUser })
          return <C />
        }
        case 'following': {
          const C = createFollowingScreen({ api, onOpenUser })
          return <C />
        }
        case 'groups': {
          const C = createGroupsScreen({ api, onOpenUser })
          return <C />
        }
        case 'bookmarks': {
          const C = createBookmarksScreen({ api, onOpenUser })
          return <C />
        }
        case 'settings': {
          const C = createAuthScreen({ api, onAuthChanged: () => setTab('home') })
          return <C />
        }
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tab])
    return (
      <View style={styles.shell}>
        <View style={styles.body}>{content}</View>
        <TabBar
          active={tab}
          onSelect={(t) => {
            onTabChange(t)
            setTab(t)
          }}
        />
      </View>
    )
  }
}

const styles = StyleSheet.create({
  shell: { flex: 1 },
  body: { flex: 1 },
})

export function routerPlugin(slots: SlotCore<unknown>): CordisPlugin {
  return {
    name: 'ui-router',
    apply(ctx, config) {
      const baseUrl = String((config as { baseUrl?: string } | undefined)?.baseUrl ?? 'http://10.0.2.2:12000')
      const api = createApiClient(baseUrl)
      let dispose: (() => void) | null = null
      let lastTab: 'home' | 'following' | 'groups' | 'bookmarks' | 'settings' = 'home'

      const mount = (screen: React.ComponentType) => {
        dispose?.()
        dispose = slots.register(MAIN_SLOT, { component: screen } satisfies ScreenEntry, { key: MAIN_BODY_KEY })
      }

      /** 用户主页：从 AppShell 进入；返回后按原 tab 重装配。 */
      const openUser = (handle: string) => {
        mount(createUserScreen({ handle, api, onBack: () => void resolveInitial(), onOpenUser: openUser }))
      }

      /** 初始装配：凭据已配置 → AppShell（记住上次 tab）；否则 → 认证设置全屏。 */
      const resolveInitial = () => {
        void (async () => {
          const r = await api.credentialStatus()
          if (isOk(r) && r.data.configured) {
            mount(
              createAppShell({
                api,
                onOpenUser: openUser,
                initialTab: lastTab,
                onTabChange: (t) => {
                  lastTab = t
                },
              }),
            )
          } else {
            mount(createAuthScreen({ api, onAuthChanged: () => void resolveInitial() }))
          }
        })()
      }

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