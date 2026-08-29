/**
 * P2.2 首个"正常方式开发"的远端插件:时钟面板。
 *
 * 书写形态 = 普通 TSX(import/JSX/类型全部合法);构建管线
 * (scripts/build-chunk.sh)把它编译成 IIFE 裸脚本并追加 __face_plugins
 * 注册行 —— 运行时的下载/求值/rev 缓存/slot 挂载与手写 demo 完全同款。
 *
 * 技术意义:chunk 内具备状态(useState)与副作用(setInterval + 清理),
 * 证明远端插件的能力底线是"真功能"而不只是换文字。
 */

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

export function create(env: ModuleEnv) {
  const { React, ReactNative: RN, slots } = env

  function two(value: number): string {
    return value < 10 ? `0${value}` : String(value)
  }

  function ClockPanel() {
    const [now, setNow] = React.useState(() => new Date())
    React.useEffect(() => {
      const timer = setInterval(() => setNow(new Date()), 1000)
      return () => clearInterval(timer)
    }, [])
    const time = `${two(now.getHours())}:${two(now.getMinutes())}:${two(now.getSeconds())}`
    return React.createElement(
      RN.View,
      { style: styles().root, testID: 'clock-panel-root' },
      React.createElement(RN.Text, { style: styles().title }, '远端插件:时钟面板'),
      React.createElement(RN.Text, { style: styles().time }, time),
    )
  }

  return {
    name: 'clock-panel',
    inject: [],
    apply(ctx: {
      effect(execute: () => (() => void) | void, label?: string): unknown
    }) {
      ctx.effect(
        () => slots.register('main', { component: ClockPanel }, { key: 'body', priority: -1 }),
        'clock-panel.slot(main/body)',
      )
    },
  }
}

function styles() {
  // env 注入的 RN 是完整包;StyleSheet 走运行时取用,避免顶层依赖。
  return {
    root: {
      flex: 1,
      backgroundColor: '#101014',
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      gap: 10,
    },
    title: { color: '#9ca3af', fontSize: 13 },
    time: { color: '#e5e7eb', fontSize: 44, fontWeight: '700' as const, fontVariant: ['tabular-nums'] },
  }
}
