import { defineConfig } from 'vitest/config'

// react-native 在 Node 档不可导入；用替身让插件树可整体装配。
// tests/legacy-dsh 为继承自 android-face 的 dsh 特性测试（依赖旧基线，M1 业务插件落地后回归）。
export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^react-native$/,
        replacement: new URL('./tests/stubs/react-native.ts', import.meta.url).pathname,
      },
    ],
  },
  test: {
    environment: 'node',
    exclude: ['**/node_modules/**', 'tests/legacy-dsh/**'],
  },
})
