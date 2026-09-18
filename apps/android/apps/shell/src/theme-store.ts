/**
 * 主题偏好的持久化（AsyncStorage）。
 *
 * 与 theme-context 分离：组件只依赖上下文，存储只在壳（App.tsx）冷启动/变更时调用，
 * 因此 Node 档单测导入主题相关模块无需替身 AsyncStorage。
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import { DEFAULT_THEME_MODE, isThemeMode, THEME_MODE_KEY, type ThemeMode } from './theme'

/** 读取已保存偏好；无值/损坏/读失败 → 默认（跟随系统）。 */
export async function loadThemeMode(): Promise<ThemeMode> {
  try {
    const raw = await AsyncStorage.getItem(THEME_MODE_KEY)
    return isThemeMode(raw) ? raw : DEFAULT_THEME_MODE
  } catch {
    return DEFAULT_THEME_MODE
  }
}

/** 保存偏好；写失败静默（本次会话仍然生效）。 */
export async function saveThemeMode(mode: ThemeMode): Promise<void> {
  try {
    await AsyncStorage.setItem(THEME_MODE_KEY, mode)
  } catch {
    /* 设备存储不可用：忽略持久化失败 */
  }
}
