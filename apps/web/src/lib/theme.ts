/**
 * 主题偏好模型：三态（跟随系统 / 浅色 / 深色），默认跟随系统。
 *
 * 本文件只放纯逻辑 + DOM 应用，不依赖 React，便于单测与首帧内联脚本复用同一套规则。
 * 主题落盘 key 与规则被 index.html 的首帧脚本、main.tsx 的 initTheme() 共用。
 */

export type ThemeMode = "system" | "light" | "dark"
export type ResolvedTheme = "light" | "dark"

/** 偏好落盘 key（index.html 内联脚本硬编码同一字面量，改动需同步）。 */
export const THEME_STORAGE_KEY = "twibot.theme"

/** 默认偏好：跟随系统。 */
export const DEFAULT_THEME_MODE: ThemeMode = "system"

/** 设置页展示用的选项（顺序即 UI 顺序）。 */
export const THEME_OPTIONS: ReadonlyArray<{
  value: ThemeMode
  label: string
  hint: string
}> = [
  { value: "system", label: "跟随系统", hint: "随设备外观自动切换（默认）" },
  { value: "light", label: "浅色", hint: "始终使用浅色主题" },
  { value: "dark", label: "深色", hint: "始终使用深色主题" },
]

/** 校验任意值是否为合法偏好。 */
export function isThemeMode(value: unknown): value is ThemeMode {
  return value === "system" || value === "light" || value === "dark"
}

/** 读取已保存偏好；无值/损坏/隐私模式受限 → 回退默认（跟随系统）。 */
export function readThemeMode(): ThemeMode {
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY)
    return isThemeMode(raw) ? raw : DEFAULT_THEME_MODE
  } catch {
    return DEFAULT_THEME_MODE
  }
}

/** 保存偏好；写失败静默（本次会话仍然生效）。 */
export function writeThemeMode(mode: ThemeMode): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode)
  } catch {
    /* 隐私模式/配额受限：忽略持久化失败 */
  }
}

/** 系统是否偏好深色。 */
export function systemPrefersDark(): boolean {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
  } catch {
    return false
  }
}

/** 偏好 + 系统外观 → 实际生效主题；system 由 prefersDark 决定。 */
export function resolveTheme(mode: ThemeMode, prefersDark: boolean): ResolvedTheme {
  if (mode === "light") return "light"
  if (mode === "dark") return "dark"
  return prefersDark ? "dark" : "light"
}

/** 应用到 <html>：切 .dark 类并同步 color-scheme（表单控件/滚动条跟随）。 */
export function applyTheme(
  theme: ResolvedTheme,
  root: HTMLElement = document.documentElement,
): void {
  root.classList.toggle("dark", theme === "dark")
  root.style.colorScheme = theme
}

/** 首帧同步一次主题（与 index.html 内联脚本同规则，避免闪烁）。 */
export function initTheme(): ResolvedTheme {
  const theme = resolveTheme(readThemeMode(), systemPrefersDark())
  applyTheme(theme)
  return theme
}
