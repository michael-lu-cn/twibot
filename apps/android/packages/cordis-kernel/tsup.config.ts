import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'tsup'

const here = dirname(fileURLToPath(import.meta.url))
/** 只读引用 pinned 的 vendored 源码（自 ../cordis/tmp-research 复制，不随改，遵循 vendor 同步纪律） */
const VENDOR = resolve(here, '../../tmp-research/deepseek-harness/vendor')

/**
 * 实验 0 的补丁集，以 banner 形式注入到产物最前面：
 * 必须先于全部内核代码执行，模块作用域代码才能看到被补全的全局。
 * - WeakRef：Hermes 不支持；仅内核 logger 元数据使用，占位实现放弃 GC 回收语义即可。
 * - Object.hasOwn：ES2022，老引擎兜底。
 */
const POLYFILL_BANNER = `
if (typeof globalThis.WeakRef !== 'function') {
  globalThis.WeakRef = function WeakRef(target) { this.__target = target };
  globalThis.WeakRef.prototype.deref = function () { return this.__target };
}
if (typeof Object.hasOwn !== 'function') {
  Object.hasOwn = function (object, property) {
    return Object.prototype.hasOwnProperty.call(object, property);
  };
}
`

export default defineConfig({
  entry: { 'cordis.kernel': resolve(VENDOR, 'cordis/src/index.ts') },
  format: ['esm'],
  target: ['es2020'],
  platform: 'neutral',
  splitting: false,
  sourcemap: true,
  banner: { js: POLYFILL_BANNER },
  outDir: resolve(here, 'dist'),
  silent: false,
  esbuildOptions(options) {
    options.alias = {
      '@deepseek-ai/cosmokit': resolve(VENDOR, 'cosmokit/src/index.ts'),
    }
  },
})
