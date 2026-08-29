/**
 * dsh web 端 --dsw-* 令牌体系的 RN 子集（P0.5 暗色对话界面）。
 * 取值与 p05-plan.md §主题令牌 一致；后续新增区块只在此扩展。
 */
export const theme = {
  colors: {
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
  },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
  radius: { sm: 8, md: 12, lg: 16 },
  fontSize: { xs: 11, sm: 13, md: 15, lg: 17 },
} as const

export type Theme = typeof theme
