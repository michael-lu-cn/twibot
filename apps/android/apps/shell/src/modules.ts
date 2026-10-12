/**
 * P1 模块表(静态版):roster 的 `module` 键 → 插件工厂。
 *
 * 工厂在安装时才执行,产出当次安装专属的插件对象(cordis 以 apply 函数为
 * registry 身份;每次新对象保证卸载/重装互不串扰)。壳的其余部分只认这张表,
 * 不认识任何具体插件——P2 把"工厂"换成"从宿主拉远端 chunk 再取导出",
 * 表的消费方零变化。
 */
import type { SlotCore } from '@twibot/face-priority-slot'

import type { CordisPlugin } from '@twibot/face-cordis-kernel'
import { chatUIPlugin } from './plugins/chat-ui'
import { helloPlugin } from './plugins/hello'
import { routerPlugin } from './plugins/router'
import { connectionPlugin } from './plugins/connection'
import { framePlugin } from './plugins/frame'
import { sessionPlugin } from './plugins/sessions'
import type { RosterStore } from './roster'

/** 工厂运行环境:宿主装配产物,非注入服务。 */
export interface ModuleEnv {
  slots: SlotCore<unknown>
  /** 注入给远端 chunk 的渲染原语(chunk 的 `require('react')` 落到它)。 */
  React: unknown
  ReactNative: unknown
  /** 插件清单:plugin-updater 等装配类插件经它读写远端行。 */
  roster: RosterStore
  /** 原生存储(RN 侧 AsyncStorage);远端 chunk 里 bare import 时经 require 面注入。 */
  AsyncStorage?: unknown
  /** react/jsx-runtime(自动 JSX 转换);同样经 require 面注入。 */
  jsxRuntime?: unknown
}

export type PluginFactory = (env: ModuleEnv) => CordisPlugin

const MODULE_TABLE: Record<string, PluginFactory> = {
  'dsh-connection': () => connectionPlugin,
  'session-store': () => sessionPlugin,
  'ui-chat': (env) => chatUIPlugin(env.slots),
  'ui-hello': (env) => helloPlugin(env.slots),
  'ui-router': (env) => routerPlugin(env.slots),
  'ui-frame': (env) => framePlugin(env),
}

/**
 * 本地模块表键集:宿主清单只允许把这几类插件远端化(清单是数据,但"能装哪些
 * 能力"仍是壳的信任边界;名单外的行一律忽略,见 plugin-sync)。
 */
export const MODULE_KEYS: readonly string[] = Object.keys(MODULE_TABLE)

/**
 * 按键取插件工厂;未知键立即抛错(误配大声失败,绝不静默跳过)。
 * @param module - roster 条目的模块键。
 */
export function resolveModule(module: string): PluginFactory {
  const factory = MODULE_TABLE[module]
  if (!factory) {
    throw new Error(`modules: unknown module "${module}" — not in the module table`)
  }
  return factory
}
