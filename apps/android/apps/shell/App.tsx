/**
 * Cordis Face 壳 —— P0.5 起：一切皆插件。
 *
 * 本组件只做四件事：选宿主地址 → boot() 装配插件树 → 渲染 slot 'main' 胜出的组件 →
 * 收口边到边（edge-to-edge）下的安全区与状态栏样式。
 * 装配后由 plugin-sync 持续把宿主插件清单收敛进 roster：清单里的能力换成远端
 * chunk 实现，撤掉的回退本地实现——改插件不用重装 APK。业务 UI 全部来自插件的
 * 注册；删掉对应插件 = 界面消失（注册即效果，卸载即回滚）。
 * 主题偏好（system/light/dark）在此读取/持久化，经 ThemeProvider 下发给所有 UI。
 */
import React, { useCallback, useMemo, useReducer, useRef, useState, useEffect } from 'react'
import {
  ActivityIndicator,
  AppState,
  NativeModules,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { Linking } from 'react-native'
import type { SlotCore } from '@twibot/face-priority-slot'

import { MAIN_SLOT, boot, type Shell } from './src/index'
import { setChunkStore } from './src/script-loader'
import { startPluginSync, syncRemotePlugins, type SyncResult } from './src/plugin-sync'
import type { ChatScreenEntry } from './src/plugins/chat-ui'
import { spacing as s, DEFAULT_THEME_MODE, type Theme, type ThemeMode } from './src/theme'
import { ThemeProvider, useTheme } from './src/theme-context'
import { loadThemeMode, saveThemeMode } from './src/theme-store'

/**
 * twibot face 宿主自动探测。
 *
 * 冷启动按顺序探测候选宿主，第一个 `/api/health` 答 ok 的胜出 —— 设备验收零交互，而且
 * 换局域网、换手机、换 Mac 都不用改代码或重新打包：
 *   1) 打包器主机：debug 变体的 bundle 来自 Metro，从 scriptURL 反推（Metro 换网自动跟随）；
 *   2) 127.0.0.1：`adb reverse tcp:12000 tcp:12000`（USB / 无线 adb 通用，**不受 IP 变化影响**）；
 *   3) 局域网直连：构建时写入的 Mac en0 地址（手动装 APK 的场景没有 adb，只能走这条）；
 *   4) 10.0.2.2：Android 模拟器 NAT → 宿主 127.0.0.1。
 * 全部不可达时留在 HostPicker 并列出试过的地址，可手填后重试。
 */
const API_PORT = 12000
const DEFAULT_HOST = `http://10.0.2.2:${API_PORT}`
const REVERSE_HOST = `http://127.0.0.1:${API_PORT}`
/** 构建时 Mac 的 en0 地址；DHCP 变了就在 HostPicker 手填，或改这里重打一版。 */
const LAN_HOST = `http://192.168.0.104:${API_PORT}`
const PROBE_TIMEOUT_MS = 1500

/** scriptURL 形如 http://192.168.0.104:8081/index.bundle?...（release 是 assets:// 之类 → null）。 */
function packagerHost(): string | null {
  const sourceCode = NativeModules.SourceCode as
    | { getConstants?: () => { scriptURL?: string } }
    | undefined
  const scriptURL = sourceCode?.getConstants?.().scriptURL
  if (typeof scriptURL !== 'string') return null
  const match = /^https?:\/\/([^/:\s]+)(?::\d+)?\//.exec(scriptURL)
  return match ? `http://${match[1]}:${API_PORT}` : null
}

function candidateHosts(): string[] {
  const list = [packagerHost(), REVERSE_HOST, LAN_HOST, DEFAULT_HOST]
  return list.filter((host, index): host is string => !!host && list.indexOf(host) === index)
}

async function probeHost(host: string): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    const res = await fetch(`${host}/api/health`, { signal: controller.signal })
    if (!res.ok) return false
    const body = (await res.json().catch(() => null)) as { ok?: boolean } | null
    return body?.ok === true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/** 探测候选宿主，返回第一个可达的与试过的全部地址（都不通时 host 为 null）。 */
async function pickHost(): Promise<{ host: string | null; tried: string[] }> {
  const tried = candidateHosts()
  for (const host of tried) {
    if (await probeHost(host)) return { host, tried }
  }
  return { host: null, tried }
}

// ---- slot 渲染器：订阅注册表，渲染当前胜出组件 ----

/**
 * 空槽位不再只是一句"没有界面" —— 真机（华为 logd 会吞掉 console）上这是唯一的观测面，
 * 所以把壳自认的状态直接画出来：宿主、roster 每一行的来源、最近几轮清单同步的结果。
 */
function EmptySlot({ shell, host, syncLog }: { shell: Shell; host: string; syncLog: readonly string[] }) {
  const { theme } = useTheme()
  const styles = useMemo(() => makePickerStyles(theme), [theme])
  const rows = shell.roster.get().map((row) => {
    const origin = row.remote ? `远端 rev=${row.remote.rev}` : '本地实现'
    return `· ${row.id} ← ${row.module}（${origin}）`
  })
  return (
    <View style={styles.diagBox}>
      <Text style={styles.hint}>slot 'main' 为空——没有任何插件注册界面</Text>
      <Text style={styles.diag}>宿主 {host}</Text>
      <Text style={styles.diag}>roster {rows.length} 行：</Text>
      {rows.map((line) => (
        <Text key={line} style={styles.diag}>
          {line}
        </Text>
      ))}
      {syncLog.length === 0 ? (
        <Text style={styles.diag}>还没跑过清单同步</Text>
      ) : (
        syncLog.map((line) => (
          <Text key={line} style={styles.diag}>
            {line}
          </Text>
        ))
      )}
    </View>
  )
}

function SlotView({ shell, host, syncLog }: { shell: Shell; host: string; syncLog: readonly string[] }) {
  const { theme } = useTheme()
  const styles = useMemo(() => makePickerStyles(theme), [theme])
  const { slots } = shell
  const [, force] = useReducer((count: number) => count + 1, 0)
  useEffect(() => slots.subscribe(() => force()), [slots])
  const winner = slots.resolveSlot(MAIN_SLOT)
  if (!winner) {
    return <EmptySlot shell={shell} host={host} syncLog={syncLog} />
  }
  const Component = winner.entry.component
  return <Component />
}

/** 一轮同步结果压成一行，供空槽位诊断屏显示。 */
function describeSync(result: SyncResult): string {
  const parts = (['changed', 'restored', 'dropped', 'skipped', 'failed'] as const)
    .filter((key) => result[key].length > 0)
    .map((key) => `${key}=${result[key].join(',')}`)
  return `同步 ${parts.length > 0 ? parts.join(' ') : '无变化'}`
}


// ---- 启动前的宿主选择页（开发拓扑切换用，装配完成后不再出现）----

function HostPicker({
  hostInput,
  onHostChange,
  busy,
  error,
  onStart,
}: {
  hostInput: string
  onHostChange: (value: string) => void
  busy: boolean
  error: string
  onStart: () => void
}) {
  const { theme } = useTheme()
  const styles = useMemo(() => makePickerStyles(theme), [theme])
  const chips: Array<{ label: string; value: string }> = [
    { label: 'adb reverse', value: REVERSE_HOST },
    { label: '局域网', value: LAN_HOST },
    { label: '模拟器 NAT', value: DEFAULT_HOST },
  ]

  return (
    <View style={styles.root}>
      <Text style={styles.title}>𝕏 twibot face</Text>
      <Text style={styles.subtitle}>选择 twibot API 宿主并装配插件树</Text>
      <TextInput
        style={styles.input}
        value={hostInput}
        onChangeText={onHostChange}
        placeholder="http://10.0.2.2:12000"
        placeholderTextColor={theme.colors.textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />
      <View style={styles.row}>
        {chips.map((chip) => (
          <TouchableOpacity key={chip.value} style={styles.chip} onPress={() => onHostChange(chip.value)}>
            <Text style={styles.chipText}>{chip.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <TouchableOpacity
        style={[styles.btn, busy && styles.btnDisabled]}
        onPress={onStart}
        disabled={busy}
      >
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>启动</Text>}
      </TouchableOpacity>
      {error !== '' && <Text style={styles.error}>⚠️ {error}</Text>}
    </View>
  )
}

const rootStyles = StyleSheet.create({ fill: { flex: 1 } })

/**
 * 边到边安全区 + 状态栏样式（targetSdk 36 起 Android 强制 edge-to-edge，不做这一步
 * 内容会画到状态栏/手势条底下）。
 *
 * - 顶部留白用 `background`（各屏 header 的底色），底部留白用 `surface`（TabBar 的底色），
 *   这样状态栏与手势条后面是连续色块，不会出现横向接缝；
 * - 嵌套 SafeAreaView 会自动扣掉祖先已消费的 inset，不会叠成双份；
 * - 状态栏图标随主题取反（浅色底深图标 / 深色底浅图标），否则白底白字看不见。
 */
function ThemedRoot({ children }: { children: React.ReactNode }) {
  const { theme, scheme } = useTheme()
  return (
    <SafeAreaView
      edges={['top']}
      style={[rootStyles.fill, { backgroundColor: theme.colors.background }]}
    >
      <StatusBar
        barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor="transparent"
      />
      <SafeAreaView
        edges={['bottom']}
        style={[rootStyles.fill, { backgroundColor: theme.colors.surface }]}
      >
        {children}
      </SafeAreaView>
    </SafeAreaView>
  )
}

export default function App() {
  const [mode, setModeState] = useState<ThemeMode>(DEFAULT_THEME_MODE)
  const [shell, setShell] = useState<Shell | null>(null)
  const [hostInput, setHostInput] = useState(DEFAULT_HOST)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  /** 最近几轮清单同步的结果：空槽位时它是唯一能看见"壳到底同步到什么"的地方。 */
  const [syncLog, setSyncLog] = useState<string[]>([])
  /** 当前装配产物与宿主：回前台时补一次清单同步（见下方 AppState 订阅）。 */
  const shellRef = useRef<Shell | null>(null)
  const hostRef = useRef('')
  const stopSyncRef = useRef<(() => void) | null>(null)

  // 冷启动读取已保存的主题偏好；读取期间先用默认（跟随系统）。
  useEffect(() => {
    let alive = true
    void loadThemeMode().then((saved) => {
      if (alive) setModeState(saved)
    })
    return () => {
      alive = false
    }
  }, [])

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next)
    void saveThemeMode(next)
  }, [])

  const start = useCallback(async (rawHost: string) => {
    const host = rawHost.trim().replace(/\/+$/, '')
    console.log('[twibot] boot host =', host)
    setBusy(true)
    setError('')
    try {
      // P2.3 持久化 chunk 缓存:冷启动命中 AsyncStorage 即跳过网络(幂等装配)。
      setChunkStore(AsyncStorage)
      const shell = await boot(host)
      // P2.2 热更新通道已接通：宿主清单（/plugins/manifest.json）→ roster 远端化。
      // 改插件源码 → 重建 chunk（rev 变）→ 壳卸旧装新，不重装 APK、不用 Metro。
      // 清单不可达、或 chunk 预热失败，都保留本地实现（离线照样可用）。
      shellRef.current = shell
      hostRef.current = host
      stopSyncRef.current?.()
      stopSyncRef.current = startPluginSync(shell, host, {
        onResult: (result) => {
          const line = describeSync(result)
          console.log('[plugin-sync]', line)
          setSyncLog((log) => [line, ...log].slice(0, 6))
        },
      })

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
  }, [])

  // 手动启动严格用输入框里的地址，不做探测（点了「启动」就听用户的）。
  const onStart = useCallback(() => {
    void start(hostInput)
  }, [start, hostInput])

  // 回前台即补一次清单同步：开发时重建完 chunk，切回 App 就能看到新版本。
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      const current = shellRef.current
      if (state !== 'active' || current === null) return
      void syncRemotePlugins(current, hostRef.current)
        .then((result) => {
          const line = `回前台 ${describeSync(result)}`
          console.log('[plugin-sync]', line)
          setSyncLog((log) => [line, ...log].slice(0, 6))
        })
        .catch((cause: unknown) => {
          console.warn('[plugin-sync] 回前台同步失败:', cause)
        })
    })
    return () => {
      sub.remove()
      stopSyncRef.current?.()
    }
  }, [])

  // 冷启动自动探测宿主并启动——设备验收零交互，换局域网/换机器都不用改代码或重打。
  // 一个都不通就留在选择页，把试过的地址列出来让人手填重试。
  const autoStarted = React.useRef(false)
  React.useEffect(() => {
    if (autoStarted.current) return
    autoStarted.current = true
    void (async () => {
      setBusy(true)
      const { host, tried } = await pickHost()
      if (!host) {
        setBusy(false)
        setError(
          `没有可达的 twibot API 宿主（已尝试 ${tried.join('、')}）。` +
            `请确认 API 已启动；真机可先执行 adb reverse tcp:${API_PORT} tcp:${API_PORT}。`,
        )
        return
      }
      setHostInput(host)
      await start(host)
    })()
  }, [start])

  return (
    <SafeAreaProvider style={rootStyles.fill}>
      <ThemeProvider mode={mode} setMode={setMode}>
        <ThemedRoot>
          {shell ? (
            <SlotView shell={shell} host={hostRef.current} syncLog={syncLog} />
          ) : (
            <HostPicker
              hostInput={hostInput}
              onHostChange={setHostInput}
              busy={busy}
              error={error}
              onStart={() => void onStart()}
            />
          )}
        </ThemedRoot>
      </ThemeProvider>
    </SafeAreaProvider>
  )
}

const makePickerStyles = (theme: Theme) =>
  StyleSheet.create({
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
    diagBox: { flex: 1, justifyContent: 'center', padding: s.lg, gap: 2 },
    diag: { color: theme.colors.textSecondary, fontSize: 11, fontFamily: 'monospace' },
    error: { color: theme.colors.error, fontSize: theme.fontSize.sm, textAlign: 'center' },
  })
