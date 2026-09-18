/** 主题上下文：持有偏好、订阅系统外观、把结果写到 <html> 并持久化。 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import {
  applyTheme,
  readThemeMode,
  resolveTheme,
  systemPrefersDark,
  writeThemeMode,
  type ResolvedTheme,
  type ThemeMode,
} from "@/lib/theme"

export interface ThemeContextValue {
  /** 用户偏好（跟随系统 / 浅色 / 深色）。 */
  mode: ThemeMode
  /** 当前实际生效主题。 */
  theme: ResolvedTheme
  setMode: (mode: ThemeMode) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(() => readThemeMode())
  const [prefersDark, setPrefersDark] = useState<boolean>(() => systemPrefersDark())
  const theme = resolveTheme(mode, prefersDark)

  // 订阅系统外观变化：mode=system 时结果随之切换，其它模式也保持监听以便切回。
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)")
    const onChange = () => setPrefersDark(mq.matches)
    onChange()
    mq.addEventListener("change", onChange)
    return () => mq.removeEventListener("change", onChange)
  }, [])

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  useEffect(() => {
    writeThemeMode(mode)
  }, [mode])

  const value = useMemo<ThemeContextValue>(() => ({ mode, theme, setMode }), [mode, theme])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

/** 读取主题上下文；脱离 Provider 使用立即抛错（误配大声失败）。 */
export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext)
  if (!value) throw new Error("useTheme 必须在 <ThemeProvider> 内使用")
  return value
}
