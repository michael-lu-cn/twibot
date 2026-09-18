/**
 * 主题偏好纯逻辑：三态校验、跟随系统解析、令牌选择。
 * 运行时切换（ThemeProvider/AsyncStorage）由设备档验收，这里只锚定纯函数语义。
 */
import { describe, expect, it } from 'vitest'

import {
  createTheme,
  darkColors,
  DEFAULT_THEME_MODE,
  isThemeMode,
  lightColors,
  resolveScheme,
  spacing,
  THEME_MODE_OPTIONS,
} from '../src/theme'
import { createSettingsScreen } from '../src/screens/settings'

describe('主题偏好模型', () => {
  it('默认跟随系统', () => {
    expect(DEFAULT_THEME_MODE).toBe('system')
    expect(THEME_MODE_OPTIONS[0]?.value).toBe('system')
  })

  it('isThemeMode 只认三态', () => {
    expect(isThemeMode('system')).toBe(true)
    expect(isThemeMode('light')).toBe(true)
    expect(isThemeMode('dark')).toBe(true)
    expect(isThemeMode('DARK')).toBe(false)
    expect(isThemeMode(null)).toBe(false)
    expect(isThemeMode(undefined)).toBe(false)
    expect(isThemeMode('')).toBe(false)
  })

  it('resolveScheme：system 跟随系统，显式模式覆盖系统', () => {
    expect(resolveScheme('system', 'light')).toBe('light')
    expect(resolveScheme('system', 'dark')).toBe('dark')
    expect(resolveScheme('light', 'dark')).toBe('light')
    expect(resolveScheme('dark', 'light')).toBe('dark')
  })

  it('createTheme：颜色随方案切换，间距/圆角/字号共享', () => {
    const light = createTheme('light')
    const dark = createTheme('dark')
    expect(light.scheme).toBe('light')
    expect(light.colors).toBe(lightColors)
    expect(dark.colors).toBe(darkColors)
    expect(light.colors.background).not.toBe(dark.colors.background)
    expect(light.spacing).toBe(spacing)
    expect(dark.spacing).toBe(spacing)
    expect(light.fontSize).toBe(dark.fontSize)
  })

  it('设置屏工厂返回命名组件（路由 case settings 可装配）', () => {
    const Screen = createSettingsScreen({ api: {} as never, onOpenAuth: () => {} })
    expect(typeof Screen).toBe('function')
    expect(Screen.name).toBe('SettingsScreen')
  })
})
