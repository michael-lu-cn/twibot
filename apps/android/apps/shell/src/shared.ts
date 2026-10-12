/**
 * 跨「壳 ↔ 远端 chunk」的单例登记处（P2.2）。
 *
 * chunk 是独立打包、独立求值的代码：`import` 关系不跨越这条边界，同一个源文件
 * 在壳里和 chunk 里各求值一份。对纯函数/纯组件无所谓；但对「身份即语义」的模块
 * 是致命的 —— 典型是 React context：壳的 `<ThemeProvider>` 提供的是壳那份
 * `ThemeContext`，chunk 里的 `useTheme()` 读的是 chunk 那份，于是永远读不到
 * Provider，报「useTheme 必须在 <ThemeProvider> 内使用」。
 *
 * 需要跨边界唯一的模块用 {@link shareModule} 登记：先到者（壳，或先装上的那个
 * chunk）建实例，后来者复用。登记表挂在 `globalThis` 上，因此壳与所有 chunk
 * （无论哪个副本的 shared.ts）看到的是同一张表。
 *
 * 边界：只登记"必须唯一"的东西（context、长生命周期 store、单例服务句柄）。
 * 组件、工具函数、类型不要登记 —— 它们按副本存在是正确的，登记只会掩盖真问题。
 */
export function shareModule<T>(key: string, factory: () => T): T {
  const holder = globalThis as typeof globalThis & { __face_shared?: Record<string, unknown> }
  holder.__face_shared ??= {}
  const existing = holder.__face_shared[key]
  if (existing !== undefined) return existing as T
  const created = factory()
  holder.__face_shared[key] = created
  return created
}
