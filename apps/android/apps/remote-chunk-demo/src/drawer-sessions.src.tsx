/**
 * S1 并行开发:drawer-sessions —— 会话列表抽屉(远端 chunk 插件)。
 *
 * 注册到左抽屉槽位:slots.register('drawer', {component}, {key:'left'}),
 * 与并行流的 ui-frame 壳插件按 keyed cell 'left' 契约汇合(见
 * apps/shell/src/types.ts 的 DRAWER_SLOT / DRAWER_LEFT)。
 *
 * 书写形态 = 普通 TSX(类型/import 全合法),构建管线(scripts/build-chunk.sh)
 * 编译成 IIFE 裸脚本并追加 __face_plugins 注册行;运行时经 fetch + new Function
 * 求值(见 apps/shell/src/chunk-registry.ts)。
 *
 * 技术约束(与 clock-panel 同款):
 * - 禁止任何静态 import —— React/RN 全部由壳注入(env.React / env.ReactNative);
 *   不写 JSX(esbuild --jsx=transform 会展开成作用域内不存在的 React.createElement),
 *   一律 env.React.createElement(...);
 * - 注入服务在 apply(ctx) 内以 ctx.dsh / ctx.sessions 读取;
 * - 注册动作包在 ctx.effect 里:插件卸载 = slot 注销 = UI 消失(注册即效果,卸载即回滚)。
 *
 * 构建复演: bash scripts/build-chunk.sh drawer-sessions
 */

/** 会话列表一行(宿主 dsh.listSessions 返回的子集)。 */
interface SessionRow {
  sessionId: string
  updatedAt: number
  running: boolean
  blank: boolean
}

/** 壳注入的模块环境(构建时不可知,运行时由装配器传入)。 */
interface ModuleEnv {
  slots: {
    register(
      slotId: string,
      entry: { component: unknown },
      options?: { priority?: number; key?: string },
    ): () => void
  }
  React: {
    createElement(...args: unknown[]): unknown
    useState<T>(initial: T): [T, (value: T) => void]
    useEffect(effect: () => (() => void) | void, deps?: unknown[]): void
  }
  ReactNative: Record<string, unknown>
}

/** apply 收到的注入服务面(与壳 types.ts 契约一致的最小声明)。 */
interface DrawerApplyCtx {
  dsh: {
    listSessions(): Promise<SessionRow[]>
    startSession(): Promise<{ sessionId: string }>
    connectionState: string
  }
  sessions: {
    state: {
      sessionId: string | null
      messages: unknown[]
      isStreaming: boolean
      connected: boolean
    }
    subscribe(listener: () => void): () => void
    switchTo(sessionId: string): Promise<void>
    newSession(): Promise<string>
  }
  effect(execute: () => (() => void) | void, label?: string): unknown
}

export function create(env: ModuleEnv) {
  const { React, ReactNative: RN, slots } = env
  /** 本地 createElement 助手(chunk 作用域没有 React 标识符)。 */
  const h = React.createElement

  /** 短 id:取前 8 位 + 省略号(行内展示,避免整串占满)。 */
  function shortId(id: string): string {
    return id.length <= 8 ? id : `${id.slice(0, 8)}…`
  }

  /** 本地化时间:MM/DD HH:MM(updatedAt 是 epoch ms)。 */
  function fmtTime(ts: number): string {
    const d = new Date(ts)
    const two = (v: number): string => (v < 10 ? `0${v}` : String(v))
    return `${d.getMonth() + 1}/${d.getDate()} ${two(d.getHours())}:${two(d.getMinutes())}`
  }

  /** 异常 → 可读文案。 */
  function detail(cause: unknown): string {
    return cause instanceof Error ? cause.message : String(cause)
  }

  return {
    name: 'drawer-sessions',
    inject: ['dsh', 'sessions'],
    apply(ctx: DrawerApplyCtx) {
      const dsh = ctx.dsh
      const sessions = ctx.sessions

      /** 会话列表抽屉(仿 chat-ui 的 createChatScreen:工厂闭包捕获服务实例)。 */
      function SessionsDrawer() {
        const [items, setItems] = React.useState<SessionRow[]>([])
        const [loading, setLoading] = React.useState(true)
        const [error, setError] = React.useState('')
        const [notice, setNotice] = React.useState('')
        const [busy, setBusy] = React.useState(false)
        const [currentId, setCurrentId] = React.useState<string | null>(
          sessions.state.sessionId,
        )

        // 当前会话随服务投影变化(sessions.switchTo/newSession 都会改)。
        React.useEffect(() => {
          const off = sessions.subscribe(() => setCurrentId(sessions.state.sessionId))
          return off
        }, [])

        // 打开即加载:拉全量列表 → loading / error 两态。
        React.useEffect(() => {
          let alive = true
          setLoading(true)
          dsh
            .listSessions()
            .then((rows) => {
              if (!alive) return
              setItems(rows)
              setError('')
            })
            .catch((cause: unknown) => {
              if (!alive) return
              setError(detail(cause))
            })
            .finally(() => {
              if (alive) setLoading(false)
            })
          return () => {
            alive = false
          }
        }, [])

        /** 重拉列表(切换/新建后刷新,失败仅提示不阻断)。 */
        const refresh = (): Promise<void> =>
          dsh
            .listSessions()
            .then((rows) => setItems(rows))
            .then(() => undefined)

        /** 点击行:切换会话 → 重拉列表;成败都有行内轻提示。 */
        const onSelect = (sessionId: string): void => {
          if (busy || sessionId === currentId) return
          setBusy(true)
          setNotice('')
          void (async () => {
            let failed = ''
            try {
              await sessions.switchTo(sessionId)
            } catch (cause) {
              failed = `切换失败:${detail(cause)}`
            }
            try {
              await refresh()
            } catch (cause) {
              failed = failed
                ? `${failed};列表刷新失败:${detail(cause)}`
                : `列表刷新失败:${detail(cause)}`
            }
            setNotice(failed ? `⚠️ ${failed}` : `已切换到 ${shortId(sessionId)}`)
            setBusy(false)
          })()
        }

        /** 底部按钮:新建会话 → 重拉列表(滚动免了,重拉即可)。 */
        const onNew = (): void => {
          if (busy) return
          setBusy(true)
          setNotice('')
          void (async () => {
            let created = ''
            let failed = ''
            try {
              created = await sessions.newSession()
            } catch (cause) {
              failed = `新建失败:${detail(cause)}`
            }
            try {
              await refresh()
            } catch (cause) {
              failed = failed
                ? `${failed};列表刷新失败:${detail(cause)}`
                : `列表刷新失败:${detail(cause)}`
            }
            setNotice(
              failed ? `⚠️ ${failed}` : created ? `已新建 ${shortId(created)}` : '',
            )
            setBusy(false)
          })()
        }

        const s = styles()

        const renderRow = (item: SessionRow) => {
          const isCurrent = item.sessionId === currentId
          return h(
            RN.TouchableOpacity,
            {
              key: item.sessionId,
              style: [s.row, isCurrent ? s.rowCurrent : null],
              onPress: () => onSelect(item.sessionId),
              disabled: busy,
              activeOpacity: 0.7,
              accessibilityLabel: `会话 ${shortId(item.sessionId)}`,
            },
            h(
              RN.View,
              { style: s.rowHeader },
              h(
                RN.Text,
                {
                  style: [s.rowId, isCurrent ? s.rowIdCurrent : null],
                  numberOfLines: 1,
                },
                shortId(item.sessionId),
              ),
              item.blank ? h(RN.Text, { style: s.rowBlank }, '(空)') : null,
              item.running ? h(RN.Text, { style: s.rowRunning }, '…') : null,
              isCurrent ? h(RN.Text, { style: s.rowCurrentTag }, '当前') : null,
            ),
            h(RN.Text, { style: s.rowTime }, fmtTime(item.updatedAt)),
          )
        }

        return h(
          RN.View,
          { style: s.root, testID: 'drawer-sessions-root' },
          h(
            RN.View,
            { style: s.header },
            h(RN.Text, { style: s.title }, '会话列表'),
            h(RN.Text, { style: s.subtitle }, `${items.length} 个会话`),
          ),
          h(
            RN.ScrollView,
            { style: s.list, contentContainerStyle: s.listContent },
            loading
              ? h(
                  RN.View,
                  { style: s.center },
                  h(RN.ActivityIndicator, { color: '#8b5cf6' }),
                  h(RN.Text, { style: s.hint }, '加载中…'),
                )
              : error
                ? h(
                    RN.View,
                    { style: s.center },
                    h(RN.Text, { style: s.errorText }, `⚠️ ${error}`),
                  )
                : items.length === 0
                  ? h(
                      RN.View,
                      { style: s.center },
                      h(RN.Text, { style: s.hint }, '暂无会话'),
                    )
                  : h(RN.View, {}, items.map((item) => renderRow(item))),
          ),
          notice ? h(RN.Text, { style: s.notice }, notice) : null,
          h(
            RN.TouchableOpacity,
            {
              style: [s.newBtn, busy ? s.newBtnBusy : null],
              onPress: onNew,
              disabled: busy,
              accessibilityLabel: '新建会话',
            },
            busy
              ? h(RN.ActivityIndicator, { color: '#0f172a', size: 'small' })
              : h(RN.Text, { style: s.newBtnText }, '＋ 新建会话'),
          ),
        )
      }

      ctx.effect(
        () => slots.register('drawer', { component: SessionsDrawer }, { key: 'left' }),
        'drawer-sessions.slot(drawer/left)',
      )
    },
  }
}

/** 局部样式(纯对象;env 注入的 RN 是完整包,StyleSheet.create 也可运行时取用)。 */
function styles() {
  return {
    root: {
      flex: 1,
      backgroundColor: '#101014',
    },
    header: {
      paddingHorizontal: 16,
      paddingTop: 14,
      paddingBottom: 10,
      borderBottomWidth: 1,
      borderBottomColor: '#26262e',
    },
    title: { color: '#e5e7eb', fontSize: 16, fontWeight: '700' as const },
    subtitle: { color: '#9ca3af', fontSize: 12, marginTop: 2 },
    list: { flex: 1 },
    listContent: { padding: 12, gap: 8 },
    center: { alignItems: 'center' as const, justifyContent: 'center' as const, gap: 8, paddingVertical: 32 },
    hint: { color: '#9ca3af', fontSize: 13 },
    errorText: { color: '#f87171', fontSize: 13, textAlign: 'center' as const },
    row: {
      backgroundColor: '#17171d',
      borderRadius: 10,
      borderWidth: 1,
      borderColor: '#26262e',
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    rowCurrent: {
      backgroundColor: 'rgba(139,92,246,0.14)',
      borderColor: '#8b5cf6',
    },
    rowHeader: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 8,
    },
    rowId: { color: '#e5e7eb', fontSize: 14, fontWeight: '600' as const, flex: 1 },
    rowIdCurrent: { color: '#c4b5fd' },
    rowBlank: { color: '#6b7280', fontSize: 11, borderWidth: 1, borderColor: '#3f3f4a', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
    rowRunning: { color: '#fbbf24', fontSize: 13 },
    rowCurrentTag: { color: '#8b5cf6', fontSize: 11, fontWeight: '700' as const },
    rowTime: { color: '#9ca3af', fontSize: 11, marginTop: 4 },
    notice: { color: '#9ca3af', fontSize: 12, textAlign: 'center' as const, paddingHorizontal: 16, paddingVertical: 6 },
    newBtn: {
      margin: 12,
      borderRadius: 10,
      backgroundColor: '#8b5cf6',
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      paddingVertical: 12,
    },
    newBtnBusy: { opacity: 0.7 },
    newBtnText: { color: '#0f172a', fontSize: 14, fontWeight: '700' as const },
  }
}