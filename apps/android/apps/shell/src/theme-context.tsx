/**
 * 主题上下文：把「偏好 + 系统外观」解析成当次渲染的主题令牌。
 *
 * - `ThemeProvider` 由壳（App.tsx）注入 mode/setMode，本文件不碰存储（见 theme-store.ts），
 *   这样 Node 档单测导入本模块时不需要 AsyncStorage；
 * - 系统外观经 RN `useColorScheme()` 订阅，mode=system 时随之切换；
 * - 组件统一 `const { theme, mode, setMode } = useTheme()`；
 * - context 本体经 shared.shareModule 登记：远端 chunk 里也会有本文件的一份副本，
 *   不共用同一个 context 对象的话，chunk 内 `useTheme()` 就看不到壳的 Provider。
 */
import React, { createContext, useContext, useMemo } from 'react'
import { useColorScheme } from 'react-native'
import {
  createTheme,
  resolveScheme,
  type Theme,
  type ThemeMode,
  type ThemeScheme,
} from './theme'
import { shareModule } from './shared'

export interface ThemeApi {
  /** 用户偏好。 */
  mode: ThemeMode
  /** 当前实际生效方案。 */
  scheme: ThemeScheme
  /** 当前令牌（随 scheme 变化的新对象引用，可作 useMemo 依赖）。 */
  theme: Theme
  setMode(mode: ThemeMode): void
}

const ThemeContext = shareModule('theme-context', () => createContext<ThemeApi | null>(null))

export function ThemeProvider({
  mode,
  setMode,
  children,
}: {
  mode: ThemeMode
  setMode: (mode: ThemeMode) => void
  children: React.ReactNode
}) {
  const system = useColorScheme()
  const api = useMemo<ThemeApi>(() => {
    const scheme = resolveScheme(mode, system === 'dark' ? 'dark' : 'light')
    return { mode, scheme, theme: createTheme(scheme), setMode }
  }, [mode, system, setMode])
  return <ThemeContext.Provider value={api}>{children}</ThemeContext.Provider>
}

/** 读取主题上下文；脱离 Provider 使用立即抛错（误配大声失败）。 */
export function useTheme(): ThemeApi {
  const api = useContext(ThemeContext)
  if (!api) throw new Error('useTheme 必须在 <ThemeProvider> 内使用')
  return api
}
