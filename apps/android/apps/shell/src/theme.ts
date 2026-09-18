/**
 * 主题令牌：浅/深两套配色 + 与外观无关的间距/圆角/字号。
 *
 * - 偏好三态 `ThemeMode`：system（默认，跟随系统）/ light / dark；
 * - 运行时取用一律走 `useTheme()`（见 theme-context.tsx），不要再 import 下面的
 *   `theme` 静态对象——它只是给未迁移的旧插件（hello/chat-ui/frame）兜底的深色令牌；
 * - 本文件保持纯函数、零 React/RN/存储依赖，Node 档可单测。
 */

export type ThemeScheme = 'light' | 'dark'
export type ThemeMode = 'system' | 'light' | 'dark'

export interface ThemeColors {
  background: string
  surface: string
  border: string
  primary: string
  textPrimary: string
  textSecondary: string
  userBubbleBg: string
  userBubbleText: string
  assistantBubbleBg: string
  assistantBubbleText: string
  inputBg: string
  inputBorder: string
  success: string
  error: string
  streamingDot: string
}

export interface Theme {
  scheme: ThemeScheme
  colors: ThemeColors
  spacing: typeof spacing
  radius: typeof radius
  fontSize: typeof fontSize
}

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const
export const radius = { sm: 8, md: 12, lg: 16 } as const
export const fontSize = { xs: 11, sm: 13, md: 15, lg: 17 } as const

/** 深色（沿用原 P0.5 dsh 令牌，取值不变）。 */
export const darkColors: ThemeColors = {
  background: '#101014',
  surface: '#17171d',
  border: '#2b2b3a',
  primary: '#38bdf8', // twibot sky
  textPrimary: '#e5e7eb',
  textSecondary: '#9ca3af',
  userBubbleBg: '#0284c7', // twibot sky-600
  userBubbleText: '#ffffff',
  assistantBubbleBg: '#1e1e28',
  assistantBubbleText: '#cfd3ff',
  inputBg: '#0d0d11',
  inputBorder: '#2b2b3a',
  success: '#4ade80',
  error: '#f87171',
  streamingDot: '#9aa0ff',
}

/** 浅色（对齐 web 的 shadcn neutral 浅色语义 + Twitter 灰阶）。 */
export const lightColors: ThemeColors = {
  background: '#ffffff',
  surface: '#f7f8f8',
  border: '#e5e7eb',
  primary: '#0284c7', // sky-600：浅底上保证对比度
  textPrimary: '#0f1419',
  textSecondary: '#536471',
  userBubbleBg: '#0284c7',
  userBubbleText: '#ffffff',
  assistantBubbleBg: '#f1f5f9',
  assistantBubbleText: '#0f1419',
  inputBg: '#ffffff',
  inputBorder: '#cfd9de',
  success: '#16a34a',
  error: '#dc2626',
  streamingDot: '#6366f1',
}

/** 按外观方案造主题（颜色随方案切换，间距/圆角/字号共享）。 */
export function createTheme(scheme: ThemeScheme): Theme {
  return {
    scheme,
    colors: scheme === 'dark' ? darkColors : lightColors,
    spacing,
    radius,
    fontSize,
  }
}

/** 默认偏好：跟随系统。 */
export const DEFAULT_THEME_MODE: ThemeMode = 'system'

/** 偏好落盘 key（AsyncStorage）。 */
export const THEME_MODE_KEY = 'twibot.theme'

/** 设置屏展示用的选项（顺序即 UI 顺序）。 */
export const THEME_MODE_OPTIONS: ReadonlyArray<{
  value: ThemeMode
  label: string
  hint: string
}> = [
  { value: 'system', label: '跟随系统', hint: '随设备外观自动切换（默认）' },
  { value: 'light', label: '浅色', hint: '始终使用浅色主题' },
  { value: 'dark', label: '深色', hint: '始终使用深色主题' },
]

/** 校验任意值（如 AsyncStorage 回读）是否为合法偏好。 */
export function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark'
}

/** 偏好 + 系统外观 → 实际生效方案；system 直接采用系统值。 */
export function resolveScheme(mode: ThemeMode, systemScheme: ThemeScheme): ThemeScheme {
  if (mode === 'light') return 'light'
  if (mode === 'dark') return 'dark'
  return systemScheme
}

/**
 * 旧插件兜底令牌：固定深色。
 * @deprecated 新代码请用 `useTheme()`（theme-context.tsx）以支持运行时切换。
 */
export const theme: Theme = createTheme('dark')
