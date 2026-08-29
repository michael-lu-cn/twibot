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
 * 安全注记:这是教学级动态通道,代码来自宿主信任域;guard 白名单属 P3。
 */

/** chunk 约定的挂载面:接收模块环境,返回 cordis 插件形状。 */
export interface RemotePluginMount {
  mount(env: Record<string, unknown>): unknown
}

declare global {
  // eslint-disable-next-line no-var -- 必须是 var 真实全局,chunk 脚本直接读写。
  var __face_plugins: Record<string, RemotePluginMount> | undefined
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
 * @throws {Error} 求值后仍未注册该名字(chunk 违约,大声失败)。
 */
export function evalChunkCode(module: string, code: string): RemotePluginMount {
  const execute = new Function('globalThis', `"use strict";\n${code}`)
  execute(globalThis)
  const mounted = getRemoteMount(module)
  if (mounted === undefined) {
    throw new Error(
      `remote-chunk: "${module}" did not register __face_plugins["${module}"] after evaluation`,
    )
  }
  return mounted
}
