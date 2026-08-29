/**
 * P2.2 远端插件:设置抽屉(drawer-settings),注册到右抽屉。
 *
 * 与 clock-panel 同一条构建管线(scripts/build-chunk.sh):普通 TSX 源码
 * 编译成 IIFE 裸脚本 + __face_plugins 注册行;chunk 内禁止任何静态 import
 * (React/RN 全从 env 注入),禁止 JSX(esbuild --jsx=transform 会把 JSX 变成
 * 引用不存在 React 标识符的 React.createElement 调用),一律 env.React.createElement。
 *
 * 槽位契约(S0,钉死):
 *   env.slots.register('drawer', { component }, { key: 'right' })
 * 左抽屉归 drawer-sessions,本插件只占 right。
 *
 * 服务契约:
 *   inject: ['dsh', 'sessions'] —— apply(ctx) 内 ctx.dsh / ctx.sessions 可用;
 *   ctx.get('plugin-updater') —— ui-frame 提供的更新服务,防御式读取,取不到
 *   只降级 UI 文案,不影响注册与渲染。
 */

/** 壳注入的模块环境(构建时不可知,运行时由装配器传入)。 */
interface SlotRegistrationOptions {
  priority?: number
  key?: string
}

interface ModuleEnv {
  slots: {
    register(
      slotId: string,
      entry: { component: unknown },
      options?: SlotRegistrationOptions,
    ): () => void
  }
  React: {
    createElement(...args: unknown[]): unknown
    useState<T>(initial: T | (() => T)): [T, (value: ((prev: T) => T) | T) => void]
    useEffect(effect: () => (() => void) | void, deps?: readonly unknown[]): void
  }
  ReactNative: {
    View: unknown
    Text: unknown
    TouchableOpacity: unknown
    ScrollView: unknown
    ActivityIndicator: unknown
    StyleSheet: {
      create<T extends Record<string, unknown>>(obj: T): T
    }
  }
}

/** 插件清单里的一行(ui-frame plugin-updater 契约)。 */
interface PluginSummary {
  id: string
  rev: string | null
  status: 'local' | 'remote' | 'error'
}

/** 插件更新服务(ui-frame 提供;未装配时 ctx.get 返回 undefined)。 */
interface PluginUpdater {
  listPlugins(): PluginSummary[]
  /** 生效变更数;失败不抛。 */
  checkUpdates(): Promise<number>
}

/** apply 收到的上下文(自声明,运行时由 cordis 装配)。 */
interface DrawerCtx {
  dsh: { baseUrl: string; connectionState: string }
  sessions: {
    state: {
      sessionId: string | null
      connected: boolean
      isStreaming: boolean
      messages: unknown[]
    }
    subscribe(listener: (state: unknown, prevState: unknown) => void): () => void
  }
  get(name: string): unknown
  effect(execute: () => (() => void) | void, label?: string): unknown
}

export function create(env: ModuleEnv) {
  const { React, ReactNative: RN, slots } = env
  const h = React.createElement

  const s = RN.StyleSheet.create({
    root: { flex: 1, backgroundColor: '#101014', padding: 16 },
    sectionTitle: { color: '#6b7280', fontSize: 12, marginTop: 4, marginBottom: 8 },
    card: {
      backgroundColor: '#1a1b20',
      borderRadius: 12,
      padding: 12,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: '#26272e',
    },
    label: { color: '#6b7280', fontSize: 12, marginBottom: 4 },
    value: { color: '#e5e7eb', fontSize: 15 },
    row: { flexDirection: 'row', alignItems: 'center' },
    dot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
    pluginId: { color: '#e5e7eb', fontSize: 13, flexShrink: 1 },
    pluginRev: { color: '#9ca3af', fontSize: 12, marginLeft: 8 },
    badge: {
      fontSize: 11,
      borderWidth: 1,
      borderRadius: 4,
      paddingHorizontal: 6,
      paddingVertical: 1,
      overflow: 'hidden',
      marginLeft: 'auto',
    },
    button: {
      backgroundColor: '#2563eb',
      borderRadius: 10,
      paddingVertical: 12,
      alignItems: 'center',
    },
    buttonDisabled: { opacity: 0.5 },
    buttonText: { color: '#ffffff', fontSize: 15, fontWeight: '600' },
    result: { fontSize: 13, color: '#9ca3af', marginTop: 8 },
    fallback: { fontSize: 13, color: '#f59e0b' },
  })

  /** 防御式读取 plugin-updater;未装配或形状不符返回 null(UI 降级,不抛)。 */
  function updaterOf(ctx: DrawerCtx): PluginUpdater | null {
    const candidate = ctx.get('plugin-updater')
    if (
      candidate !== null &&
      candidate !== undefined &&
      typeof (candidate as PluginUpdater).listPlugins === 'function'
    ) {
      return candidate as PluginUpdater
    }
    return null
  }

  /** 连接态文案 + 状态色点(sessions 投影优先,dsh 连接机兜底)。 */
  function connectionMeta(ctx: DrawerCtx): { text: string; color: string } {
    const sessionsConnected = Boolean(ctx.sessions && ctx.sessions.state && ctx.sessions.state.connected)
    if (sessionsConnected) return { text: '已连接', color: '#22c55e' }
    const stateName = ctx.dsh ? ctx.dsh.connectionState : 'idle'
    if (stateName === 'connecting' || stateName === 'reconnecting') {
      return { text: '连接中…', color: '#f59e0b' }
    }
    if (stateName === 'connected') return { text: '已连接', color: '#22c55e' }
    return { text: '未连接', color: '#9ca3af' }
  }

  const BADGE_COLORS: Record<PluginSummary['status'], string> = {
    local: '#3b82f6',
    remote: '#8b5cf6',
    error: '#ef4444',
  }

  return {
    name: 'drawer-settings',
    inject: ['dsh', 'sessions'],
    apply(ctx: DrawerCtx) {
      /** 右抽屉面板:apply 闭包内创建,捕获 ctx(每渲染重新取快照)。 */
      function SettingsDrawer() {
        // 自动刷新:挂载即订阅 sessions 变更,另每 5s 一次兜底重渲,
        // 每轮渲染都从 ctx 重新读 dsh/sessions/plugin-updater 快照。
        const [, setTick] = React.useState(0)
        const [checking, setChecking] = React.useState(false)
        const [checkResult, setCheckResult] = React.useState<string | null>(null)

        React.useEffect(() => {
          const interval = setInterval(() => setTick((value) => value + 1), 5000)
          let unsubscribe: (() => void) | null = null
          const sessions = ctx.sessions
          if (sessions && typeof sessions.subscribe === 'function') {
            unsubscribe = sessions.subscribe(() => setTick((value) => value + 1))
          }
          return () => {
            clearInterval(interval)
            if (unsubscribe) unsubscribe()
          }
        }, [])

        // 每次渲染防御式取 updater(契约:每按一次/每次渲染读取)。
        const updater = updaterOf(ctx)

        // d) 插件清单:同步读 listPlugins;失败与缺失都落降级文案。
        let plugins: PluginSummary[] | null = null
        if (updater !== null) {
          try {
            plugins = updater.listPlugins()
          } catch {
            plugins = null
          }
        }

        const onCheckUpdates = () => {
          const current = updaterOf(ctx)
          if (current === null) {
            setCheckResult('更新服务不可用(ui-frame 未装配)')
            return
          }
          setChecking(true)
          current
            .checkUpdates()
            .then((count) => {
              setCheckResult(count > 0 ? `✓ 检查完成:${count} 个插件已更新` : '无需更新')
            })
            .catch(() => {
              setCheckResult('✗ 检查失败,请稍后重试')
            })
            .finally(() => setChecking(false))
        }

        const status = connectionMeta(ctx)
        const sessionId = ctx.sessions.state.sessionId
        const baseUrl = ctx.dsh.baseUrl

        return h(
          RN.ScrollView,
          { style: s.root, testID: 'drawer-settings-root' },
          // a) 连接
          h(RN.Text, { style: s.sectionTitle }, '连接'),
          h(
            RN.View,
            { style: s.card, testID: 'drawer-settings-connection' },
            h(RN.View, { style: s.row }, 
              h(RN.View, { style: [s.dot, { backgroundColor: status.color }] }),
              h(RN.Text, { style: s.value }, status.text),
            ),
          ),
          // b) 宿主地址
          h(RN.Text, { style: s.sectionTitle }, '宿主地址'),
          h(
            RN.View,
            { style: s.card, testID: 'drawer-settings-host' },
            h(RN.Text, { style: s.value, selectable: true }, baseUrl),
          ),
          // c) 当前会话
          h(RN.Text, { style: s.sectionTitle }, '当前会话'),
          h(
            RN.View,
            { style: s.card, testID: 'drawer-settings-session' },
            h(RN.Text, { style: s.value, selectable: true }, sessionId || '（无）'),
          ),
          // d) 插件清单
          h(RN.Text, { style: s.sectionTitle }, '插件清单'),
          h(
            RN.View,
            { style: s.card, testID: 'drawer-settings-plugins' },
            updater === null
              ? h(RN.Text, { style: s.fallback, testID: 'drawer-settings-updater-missing' }, '更新服务不可用(ui-frame 未装配)')
              : plugins === null
                ? h(RN.Text, { style: s.fallback }, '插件清单读取失败')
                : plugins.length === 0
                  ? h(RN.Text, { style: s.value }, '（空）')
                  : plugins.map((plugin) =>
                      h(
                        RN.View,
                        { key: plugin.id, style: s.row, testID: 'drawer-settings-plugin-row' },
                        h(RN.Text, { style: s.pluginId, numberOfLines: 1 }, plugin.id),
                        h(
                          RN.Text,
                          { style: s.pluginRev },
                          plugin.rev !== null ? plugin.rev.slice(0, 8) : 'null',
                        ),
                        h(
                          RN.Text,
                          {
                            style: [s.badge, { color: BADGE_COLORS[plugin.status], borderColor: BADGE_COLORS[plugin.status] }],
                          },
                          plugin.status,
                        ),
                      ),
                    ),
          ),
          // e) 检查更新
          h(RN.Text, { style: s.sectionTitle }, '插件更新'),
          h(
            RN.View,
            { style: s.card, testID: 'drawer-settings-update' },
            h(
              RN.TouchableOpacity,
              {
                style: [s.button, checking ? s.buttonDisabled : null],
                disabled: checking,
                onPress: onCheckUpdates,
                testID: 'drawer-settings-check-button',
              },
              h(RN.Text, { style: s.buttonText }, checking ? '检查中…' : '检查更新'),
            ),
            h(
              RN.Text,
              { style: s.result, testID: 'drawer-settings-check-result' },
              checkResult !== null ? checkResult : '点击检查远端插件更新',
            ),
          ),
        )
      }
      SettingsDrawer.displayName = 'SettingsDrawer'

      ctx.effect(
        () => slots.register('drawer', { component: SettingsDrawer }, { key: 'right' }),
        'drawer-settings.slot(drawer/right)',
      )
    },
  }
}