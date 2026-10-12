/**
 * 远端插件 chunk 的注册表与求值装载(P2.2)。
 *
 * chunk 是一段经典脚本(IIFE),约定向 `globalThis.__face_plugins[module]`
 * 写入 `{ mount(env) }`;mount 返回标准 cordis 对象插件。执行通道有二,
 * 终点相同:
 * - Node 档 / 无原生层:`new Function` 求值(Hermes 同样支持);
 * - 设备档:Repack 原生 ScriptLoader(loadScript 把脚本装入独立脚本上下文,
 *   globalThis 与主包共享)——见 ./script-loader.ts。
 *
 * 依赖面:`new Function` 只留 `globalThis` 与 `require` 两个形参,chunk 里
 * `require('react' | 'react-native' | 'react/jsx-runtime' | '@react-native-async-storage/async-storage')`
 * 落到宿主注入面(见 {@link ChunkEnv}),其余 bare import 一律大声失败。
 * 于是 chunk 源码可以用普通 TSX + 普通 import 写(esbuild 把它打包成 IIFE),
 * 渲染原语仍只有宿主持有的那一份实例(chunk 不重复打包 react/RN)。
 *
 * 安全注记:这是教学级动态通道,代码来自宿主信任域;guard 白名单属 P3。
 */

/** chunk 求值时注入的宿主面(bare import 只认这几项)。 */
export interface ChunkEnv {
  /** 宿主持有的 react 命名空间。 */
  React: unknown
  /** 宿主持有的 react-native 命名空间。 */
  ReactNative: unknown
  /** 宿主持有的 AsyncStorage(缺省则 use 到它的 chunk 会大声失败)。 */
  AsyncStorage?: unknown
  /** 宿主持有的 react/jsx-runtime(自动 JSX 转换用;TSX 里不写 JSX 也用不到)。 */
  jsxRuntime?: unknown
}

/** chunk 约定的挂载面:接收模块环境,返回 cordis 插件形状。 */
export interface RemotePluginMount {
  mount(env: Record<string, unknown>): unknown
}

declare global {
  // eslint-disable-next-line no-var -- 必须是 var 真实全局,chunk 脚本直接读写。
  var __face_plugins: Record<string, RemotePluginMount> | undefined
}

/**
 * ESM 互操作门面:chunk 经 esbuild 打包后,`import React from 'react'` 取值走
 * `__toESM(...).default`、`import { useState }` 走具名属性 —— 两种取法都要落在
 * 宿主的真实模块上,故用 Proxy 同时满足 `.default`、具名与对象展开。
 * `__esModule` 固定为 false,让 `__toESM` 走"包一层 + 补 default"的既有分支。
 */
function facade(resolve: () => unknown): Record<string, unknown> {
  return new Proxy({} as Record<string, unknown>, {
    get: (_target, key) => {
      const mod = resolve()
      if (key === 'default') return mod
      if (key === '__esModule') return false
      if (key === Symbol.toStringTag) return 'Module'
      return (mod as Record<string | symbol, unknown>)[key]
    },
    has: (_target, key) => key === 'default' || key === '__esModule' || key in (resolve() as object),
    ownKeys: () => Reflect.ownKeys(resolve() as object),
    getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true, value: undefined }),
  })
}

/** 宿主注入面里可被 chunk `require` 的模块名(其余一律拒绝)。 */
const REQUIRE_FACE: ReadonlyArray<{ id: string; pick(env: ChunkEnv): unknown }> = [
  { id: 'react', pick: (env) => facade(() => env.React) },
  { id: 'react-native', pick: (env) => facade(() => env.ReactNative) },
  {
    id: 'react/jsx-runtime',
    // tsconfig 的 `jsx: react-jsx`(expo 基线)会让 esbuild 走自动 JSX 转换,
    // 于是 chunk 里写 JSX 会 require 这一项;宿主转手它持有的那份即可。
    pick: (env) => {
      if (env.jsxRuntime === undefined) {
        throw new Error('remote-chunk: 宿主未注入 react/jsx-runtime')
      }
      return facade(() => env.jsxRuntime)
    },
  },
  {
    id: '@react-native-async-storage/async-storage',
    pick: (env) => {
      if (env.AsyncStorage === undefined) {
        throw new Error(
          'remote-chunk: 宿主未注入 AsyncStorage(@react-native-async-storage/async-storage)',
        )
      }
      return env.AsyncStorage
    },
  },
]

/**
 * 构造 chunk 可见的 require:只认宿主注入面,未知模块名大声失败
 * (chunk 里写 bare import 即等于"向宿主索取",索取不到宁可炸掉不静默降级)。
 */
export function createChunkRequire(env: ChunkEnv): (id: string) => unknown {
  const allowed = REQUIRE_FACE.map((face) => face.id).join(' / ')
  return (id: string) => {
    const face = REQUIRE_FACE.find((entry) => entry.id === id)
    if (face === undefined) {
      throw new Error(`remote-chunk: bare import "${id}" 不在宿主注入面(只允许 ${allowed})`)
    }
    return face.pick(env)
  }
}

function table(): Record<string, RemotePluginMount> {
  globalThis.__face_plugins ??= {}
  return globalThis.__face_plugins
}

/** 取远端 chunk 注册的挂载面;未注册返回 undefined。 */
export function getRemoteMount(module: string): RemotePluginMount | undefined {
  return table()[module]
}

/**
 * 在当前上下文求值 chunk 脚本并取回其注册的挂载面。
 * @param module - chunk 必须注册的名字(`__face_plugins[module]`)。
 * @param code - 经典脚本源码。
 * @param env - 宿主注入面;chunk 里出现 `require(...)` 时缺它即炸(不静默)。
 * @throws {Error} 求值后仍未注册该名字(chunk 违约,大声失败)。
 */
export function evalChunkCode(module: string, code: string, env?: ChunkEnv): RemotePluginMount {
  const requireFn: (id: string) => unknown =
    env === undefined
      ? () => {
          throw new Error(
            'remote-chunk: chunk 需要宿主注入面(require),但本次求值未提供 env',
          )
        }
      : createChunkRequire(env)
  const execute = new Function('globalThis', 'require', `"use strict";\n${code}`)
  execute(globalThis, requireFn)
  const mounted = getRemoteMount(module)
  if (mounted === undefined) {
    throw new Error(
      `remote-chunk: "${module}" did not register __face_plugins["${module}"] after evaluation`,
    )
  }
  return mounted
}
