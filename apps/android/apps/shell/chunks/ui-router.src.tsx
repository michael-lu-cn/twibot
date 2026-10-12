/**
 * P2.2 远端 chunk 适配器:ui-router。
 *
 * 与壳内 `src/plugins/router.tsx` 是同一份实现,只是走 chunk 通道下发:
 * 壳装配后由 plugin-sync 把宿主的 `/plugins/manifest.json` 收敛进 roster,
 * 发现本 chunk 的 rev 变了就卸掉本地实现、换上远端这一份 —— 于是"改插件"
 * 不用重装 APK。改本文件、或它 import 的任一屏/组件,都算改插件。
 *
 * 构建:bash apps/android/scripts/build-chunk.sh ui-router
 * 产物:apps/android/apps/remote-chunk-demo/dist/ui-router.client.js
 * 边界:只 external react / react-native / AsyncStorage(由壳的 require 面注入),
 * 其余依赖(含 src/ 下的屏与组件)静态打进本 chunk。
 */
import { routerPlugin } from '../src/plugins/router'

/** 壳注入面(装配器传 ModuleEnv 的子集)。 */
export function create(env: { slots: unknown }) {
  return routerPlugin(env.slots as Parameters<typeof routerPlugin>[0])
}