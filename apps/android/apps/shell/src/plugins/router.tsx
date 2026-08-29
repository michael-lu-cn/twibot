/**
 * 插件：ui-router（组合路由）
 * 按凭据状态向 slot 'main' 的 keyed cell 'body' 装配认证/推荐流/用户主页三屏：
 * - 未配置 cookie → AuthScreen；已配置 → FeedScreen；
 * - Feed 点击作者 → UserScreen；UserScreen 返回 → 重新按状态装配。
 * 切换 = 注销旧条目 + 注册新条目（注册即效果，卸载即回滚）。
 */
import React from 'react'
import type { CordisPlugin } from '@twibot/face-cordis-kernel'
import type { SlotCore } from '@twibot/face-priority-slot'

import { createApiClient, isOk } from '../lib/api-client'
import { MAIN_BODY_KEY, MAIN_SLOT } from '../types'
import { createAuthScreen } from '../screens/auth'
import { createFeedScreen } from '../screens/feed'
import { createUserScreen } from '../screens/user'

/** 本插件向 slot 注册的载荷（与 ui-chat/ui-hello 同形状）。 */
export interface ScreenEntry {
  component: React.ComponentType
}

export function routerPlugin(slots: SlotCore<unknown>): CordisPlugin {
  return {
    name: 'ui-router',
    apply(ctx, config) {
      const baseUrl = String((config as { baseUrl?: string } | undefined)?.baseUrl ?? 'http://10.0.2.2:12000')
      const api = createApiClient(baseUrl)
      let dispose: (() => void) | null = null

      const mount = (screen: React.ComponentType) => {
        dispose?.()
        dispose = slots.register(MAIN_SLOT, { component: screen } satisfies ScreenEntry, { key: MAIN_BODY_KEY })
      }

      /** 用户主页：点击作者进入；返回后重新按凭据状态装配。 */
      const openUser = (handle: string) => {
        mount(createUserScreen({ handle, api, onBack: () => void resolveInitial(), onOpenUser: openUser }))
      }

      /** 初始装配：凭据已配置 → 推荐流；否则 → 认证设置。 */
      const resolveInitial = () => {
        void (async () => {
          const r = await api.credentialStatus()
          if (isOk(r) && r.data.configured) {
            mount(createFeedScreen({ api, onOpenUser: openUser }))
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