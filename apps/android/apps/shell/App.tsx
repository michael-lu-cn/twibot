/**
 * Cordis Face 壳 —— P0.5 起：一切皆插件。
 *
 * 本组件只做三件事：选宿主地址 → boot() 装配插件树 → 渲染 slot 'main' 胜出的组件。
 * 业务 UI 全部来自 ui-chat 插件的注册；删掉对应插件 = 界面消失（注册即效果，卸载即回滚）。
 */
import React, { useCallback, useReducer, useState, useEffect } from 'react'
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Linking } from 'react-native'
import type { SlotCore } from '@twibot/face-priority-slot'

import { MAIN_SLOT, boot, type Shell } from './src/index'
import { setChunkStore } from './src/script-loader'
import type { ChatScreenEntry } from './src/plugins/chat-ui'
import { theme } from './src/theme'

/**
 * twibot face 开发拓扑：默认 10.0.2.2（模拟器 NAT → Mac 宿主 127.0.0.1:12000 →
 * 容器 twibot API，经 Mac 侧 tcp-relay 转发）；127.0.0.1 为 adb reverse 场景兜底。
 */
const DEFAULT_HOST = 'http://10.0.2.2:12000'
const USB_REVERSE_HOST = 'http://127.0.0.1:12000'

// ---- slot 渲染器：订阅注册表，渲染当前胜出组件 ----

function SlotView({ slots }: { slots: SlotCore<ChatScreenEntry> }) {
  const [, force] = useReducer((count: number) => count + 1, 0)
  useEffect(() => slots.subscribe(() => force()), [slots])
  const winner = slots.resolveSlot(MAIN_SLOT)
  if (!winner) {
    return (
      <View style={pickerStyles.center}>
        <Text style={pickerStyles.hint}>slot 'main' 为空——没有任何插件注册界面</Text>
      </View>
    )
  }
  const Component = winner.entry.component
  return <Component />
}

// ---- 启动前的宿主选择页（开发拓扑切换用，装配完成后不再出现）----

export default function App() {
  const [shell, setShell] = useState<Shell | null>(null)
  const [hostInput, setHostInput] = useState(DEFAULT_HOST)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const onStart = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      // P2.3 持久化 chunk 缓存:冷启动命中 AsyncStorage 即跳过网络(幂等装配)。
      setChunkStore(AsyncStorage)
      const shell = await boot(hostInput.trim().replace(/\/+$/, ''))
      // P2 热更新通道（publish-chunk.sh + manifest 装配）就绪后启用；
      // M0 空壳先不装配远端 chunk，Node 单测保持离线可跑。
      const updater = shell.ctx['plugin-updater'] as
        | { checkUpdates(): Promise<number> }
        | undefined
      void updater?.checkUpdates()

      setShell(shell)
      // M3 深链：冷启动初始 URL + 运行中 url 事件 → ctx.nav（twibot://bookmarks 等）。
      const nav = shell.ctx.nav as
        | { openDeepLink(url: string): void }
        | undefined
      if (nav) {
        Linking.getInitialURL()
          .then((url) => url && nav.openDeepLink(url))
          .catch(() => {})
        Linking.addEventListener('url', (e) => nav.openDeepLink(e.url))
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }, [hostInput])

  // 一切构建(dev/release)均自动以默认宿主启动——设备验收零交互；
  // 失败留在选择页可手改地址重试。
  const autoStarted = React.useRef(false)
  React.useEffect(() => {
    if (autoStarted.current) return
    autoStarted.current = true
    void onStart()
  }, [onStart])

  if (shell) return <SlotView slots={shell.slots} />

  return (
    <View style={pickerStyles.root}>
      <Text style={pickerStyles.title}>𝕏 twibot face</Text>
      <Text style={pickerStyles.subtitle}>选择 twibot API 宿主并装配插件树</Text>
      <TextInput
        style={pickerStyles.input}
        value={hostInput}
        onChangeText={setHostInput}
        placeholder="http://10.0.2.2:12000"
        placeholderTextColor={theme.colors.textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />
      <View style={pickerStyles.row}>
        <Btn label="模拟器 NAT" onPress={() => setHostInput(DEFAULT_HOST)} />
        <Btn label="USB reverse" onPress={() => setHostInput(USB_REVERSE_HOST)} />
      </View>
      <TouchableOpacity
        style={[pickerStyles.btn, busy && pickerStyles.btnDisabled]}
        onPress={() => void onStart()}
        disabled={busy}
      >
        {busy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={pickerStyles.btnText}>启动</Text>
        )}
      </TouchableOpacity>
      {error !== '' && <Text style={pickerStyles.error}>⚠️ {error}</Text>}
    </View>
  )
}

function Btn({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={pickerStyles.chip} onPress={onPress}>
      <Text style={pickerStyles.chipText}>{label}</Text>
    </TouchableOpacity>
  )
}

const s = theme.spacing

const pickerStyles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.colors.background,
    justifyContent: 'center',
    padding: s.xl,
    gap: s.md,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: s.sm },
  title: { color: theme.colors.primary, fontSize: 24, fontWeight: '800', textAlign: 'center' },
  subtitle: {
    color: theme.colors.textSecondary,
    fontSize: theme.fontSize.sm,
    textAlign: 'center',
    marginBottom: s.lg,
  },
  input: {
    backgroundColor: theme.colors.inputBg,
    borderColor: theme.colors.inputBorder,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    paddingHorizontal: s.md,
    paddingVertical: s.sm + 2,
    color: theme.colors.textPrimary,
    fontFamily: 'monospace',
    fontSize: theme.fontSize.sm,
  },
  row: { flexDirection: 'row', gap: s.sm },
  chip: {
    flex: 1,
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: theme.radius.sm,
    paddingVertical: s.sm + 2,
    alignItems: 'center',
  },
  chipText: { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm },
  btn: {
    backgroundColor: theme.colors.userBubbleBg,
    borderRadius: theme.radius.md,
    paddingVertical: s.md,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: theme.fontSize.md },
  hint: { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm },
  error: { color: theme.colors.error, fontSize: theme.fontSize.sm, textAlign: 'center' },
})
