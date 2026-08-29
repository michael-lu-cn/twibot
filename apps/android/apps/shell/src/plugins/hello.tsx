/**
 * 插件：ui-hello
 * twibot 空壳欢迎页（M0 验收：face → 宿主 API 链路）。
 * 显示标题 + 宿主地址 + 连接 /api/credential/status 的状态。
 * M1 起被 ui-auth / ui-feed 等业务插件替换。
 */
import React, { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import type { CordisPlugin } from '@twibot/face-cordis-kernel'
import type { SlotCore } from '@twibot/face-priority-slot'

import { MAIN_BODY_KEY, MAIN_SLOT } from '../types'
import { createApiClient, isOk } from '../lib/api-client'
import { theme } from '../theme'

/** 本插件向 slot 注册的载荷（与 ui-chat 同形状）。 */
export interface HelloScreenEntry {
  component: React.ComponentType
}

function createHelloScreen(baseUrl: string) {
  const api = createApiClient(baseUrl)

  return function HelloScreen() {
    const [line, setLine] = useState('正在检测宿主…')
    const [detail, setDetail] = useState('')

    const check = useCallback(async () => {
      setLine('正在检测宿主…')
      const r = await api.credentialStatus()
      if (isOk(r)) {
        setLine('宿主已连通 ✔')
        setDetail(`configured=${r.data.configured} · source=${r.data.source} · keys=${r.data.keys.join(',')}`)
      } else {
        setLine(`宿主未连通（${r.error.code}）`)
        setDetail(r.error.message)
      }
    }, [api])

    useEffect(() => {
      void check()
    }, [check])

    return (
      <View style={styles.root}>
        <View style={styles.brand}>
          <Text style={styles.title}>𝕏 twibot face</Text>
          <Text style={styles.subtitle}>Cordis × React Native · 功能与 Web 版一致</Text>
        </View>

        <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>宿主地址</Text>
            <Text style={styles.cardValue}>{baseUrl}</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>API 状态</Text>
            <Text style={styles.cardValue}>{line}</Text>
            {detail !== '' ? <Text style={styles.cardDetail}>{detail}</Text> : null}
          </View>

          <TouchableOpacity style={styles.btn} onPress={() => void check()} disabled={false}>
            <Text style={styles.btnText}>重新检测</Text>
          </TouchableOpacity>

          <Text style={styles.hint}>M0 空壳：确认 face → 宿主链路后，M1 起逐个挂载业务插件。</Text>
        </ScrollView>
      </View>
    )
  }
}

export function helloPlugin(slots: SlotCore<unknown>): CordisPlugin {
  return {
    name: 'ui-hello',
    apply(ctx, config) {
      const baseUrl = String((config as { baseUrl?: string } | undefined)?.baseUrl ?? 'http://127.0.0.1:12000')
      const HelloScreen = createHelloScreen(baseUrl)
      ctx.effect(
        () =>
          slots.register(
            MAIN_SLOT,
            { component: HelloScreen } satisfies HelloScreenEntry,
            { key: MAIN_BODY_KEY },
          ),
        'ui-hello.slot(main/body)',
      )
    },
  }
}

const s = theme.spacing

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  brand: { padding: s.xl, paddingTop: s.xl * 1.5 },
  title: { color: theme.colors.primary, fontSize: 26, fontWeight: '800' },
  subtitle: { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm, marginTop: s.xs },
  body: { flex: 1 },
  bodyContent: { padding: s.xl, gap: s.md },
  card: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    padding: s.md,
    gap: s.xs,
  },
  cardLabel: { color: theme.colors.textSecondary, fontSize: theme.fontSize.xs },
  cardValue: { color: theme.colors.textPrimary, fontSize: theme.fontSize.md, fontWeight: '600' },
  cardDetail: { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm },
  btn: {
    backgroundColor: theme.colors.userBubbleBg,
    borderRadius: theme.radius.md,
    paddingVertical: s.md,
    alignItems: 'center',
  },
  btnText: { color: '#fff', fontWeight: '700', fontSize: theme.fontSize.md },
  hint: { color: theme.colors.textSecondary, fontSize: theme.fontSize.xs, textAlign: 'center', marginTop: s.sm },
})