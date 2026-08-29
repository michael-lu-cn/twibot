/**
 * S1 ui-frame 验收:plugin-updater manifest 装配 / 抽屉槽位渲染 / frame 存在性。
 *
 * - 用例 a:plugin-updater.checkUpdates() 把 manifest 交集装配成 roster 远端行,
 *   rev 变更 = 换版替换(不产生重复 id);
 * - 用例 b:远端 drawer chunk 注册抽屉槽位 left cell,增删行随 slot 出现/消失;
 * - 用例 c:MAIN_SLOT 隐式 cell 由 frame 占据,body cell 由 ui-chat 占据(S0 契约)。
 *
 * Node 档走本地 http serve(仿 remote-chunk.test.ts);manifest 默认指向设备组合层
 * 常量,测试里把 ui-frame 行重配为本地服务地址(remount 走公共 roster API)。
 */
import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { boot, MAIN_SLOT } from '../src/index'
import { resetChunkCacheForTests } from '../src/script-loader'
import { DRAWER_LEFT, DRAWER_SLOT, MAIN_BODY_KEY } from '../src/types'
import { MockHost } from '../../../packages/protocol-client/tests/mock-host'

const hosts: MockHost[] = []
const servers: Server[] = []

afterEach(() => {
  for (const host of hosts) host.close()
  hosts.length = 0
  for (const server of servers) server.close()
  servers.length = 0
  resetChunkCacheForTests()
})

async function makeHost(): Promise<MockHost> {
  const host = new MockHost()
  await host.listen()
  hosts.push(host)
  return host
}

/** 按路径路由的小 HTTP 服务(manifest.json 与 chunk 各回各的);返回 base url。 */
async function serveRoutes(routes: Record<string, () => string>): Promise<string> {
  const server = createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://local').pathname
    const body = routes[pathname]?.() ?? ''
    res.writeHead(200, {
      'content-type': pathname.endsWith('.json') ? 'application/json' : 'application/javascript',
    })
    res.end(body)
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  return `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
}

/** 空插件 chunk:只完成挂载面注册,不碰任何 slot(装配成功即可)。 */
const inertChunk = `
(function (global) {
  global.__face_plugins = global.__face_plugins || {};
  global.__face_plugins['drawer-a'] = {
    mount: function (env) {
      return { name: 'drawer-a', inject: [], apply: function (ctx) {} };
    },
  };
})(globalThis);
`

/** 左抽屉 chunk:注册 drawer 槽位 left cell。 */
const leftDrawerChunk = `
(function (global) {
  global.__face_plugins = global.__face_plugins || {};
  global.__face_plugins['drawer-a'] = {
    mount: function (env) {
      function DrawerA() { return env.React.createElement('drawer-a', null) }
      DrawerA.displayName = 'DrawerA';
      return {
        name: 'drawer-a',
        inject: [],
        apply: function (ctx) {
          ctx.effect(function () {
            return env.slots.register('drawer', { component: DrawerA }, { key: 'left' });
          }, 'drawer-a.slot(drawer/left)');
        },
      };
    },
  };
})(globalThis);
`

/** cordis 的 effect 回滚是异步链;增删行后让微任务/定时器排空。 */
const tick = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms))

/** 把默认 ui-frame 行重配为指向本地插件服务(测试环境够不到设备组合层常量)。 */
async function repointUpdater(shell: Awaited<ReturnType<typeof boot>>, config: unknown) {
  shell.roster.remove('ui-frame')
  // cordis 卸载链是异步的(registry.delete 急切移除 + fiber 惰性卸载):
  // 让出充足宏任务,否则旧 plugin-updater 实例还挂在 ctx 上。
  await tick(80)
  shell.roster.add({ id: 'ui-frame', module: 'ui-frame', config })
  // 轮询验证重装生效:ctx 上的 plugin-updater 必须反映新配置(有界等待)。
  const expected = (config as { plugins: string[] }).plugins.join(',')
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await tick(30)
    const updater = shell.ctx['plugin-updater'] as
      | { listPlugins(): Array<{ id: string; rev: string | null; status: string }> }
      | undefined
    if (updater && updater.listPlugins().map((plugin) => plugin.id).join(',') === expected) return
  }
  throw new Error('repointUpdater: ui-frame 重装未生效(plugin-updater 未反映新配置)')
}

describe('S1 ui-frame × plugin-updater', () => {
  it('checkUpdates:manifest 交集装配远端行;rev 变更换版不产生重复', async () => {
    const host = await makeHost()
    let manifestBody = JSON.stringify({
      entries: [{ id: 'drawer-a', url: '/plugins/drawer-a.client.js?rev=r1', rev: 'r1' }],
    })
    const base = await serveRoutes({
      '/manifest.json': () => manifestBody,
      '/drawer-a.client.js': () => inertChunk,
    })

    const shell = await boot(host.baseUrl)
    // 基线不含 drawer-a:先无此行。
    expect(shell.roster.get().some((row) => row.id === 'drawer-a')).toBe(false)

    await repointUpdater(shell, { plugins: ['drawer-a'], base })
    const updater = shell.ctx['plugin-updater'] as {
      listPlugins(): Array<{ id: string; rev: string | null; status: string }>
      checkUpdates(): Promise<number>
    }

    // 首次装配:新增一行,rev r1。
    expect(await updater.checkUpdates()).toBe(1)
    await tick(40)
    let row = shell.roster.get().find((entry) => entry.id === 'drawer-a')
    expect(row).toBeTruthy()
    expect(row!.remote).toEqual({ url: `${base}/drawer-a.client.js?rev=r1`, rev: 'r1' })
    expect(row!.remote!.url).toContain('drawer-a.client.js?rev=r1')
    expect(updater.listPlugins()).toEqual([
      { id: 'drawer-a', rev: 'r1', status: 'remote' },
    ])

    // manifest 升级到 r2:同一 id 行被替换,且无重复。
    manifestBody = JSON.stringify({
      entries: [{ id: 'drawer-a', url: '/plugins/drawer-a.client.js?rev=r2', rev: 'r2' }],
    })
    expect(await updater.checkUpdates()).toBe(1)
    await tick(40)
    expect(shell.roster.get().filter((entry) => entry.id === 'drawer-a')).toHaveLength(1)
    row = shell.roster.get().find((entry) => entry.id === 'drawer-a')
    expect(row!.remote!.rev).toBe('r2')
    expect(row!.remote!.url).toContain('drawer-a.client.js?rev=r2')

    // rev 未变的再次检查 = 无变更。
    expect(await updater.checkUpdates()).toBe(0)
  })

  it('manifest 不可达:失败只记日志,返回 0,roster 不受影响', async () => {
    const host = await makeHost()
    const shell = await boot(host.baseUrl)
    const errSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await repointUpdater(shell, { plugins: ['drawer-a'], base: 'http://127.0.0.1:1' })
      const updater = shell.ctx['plugin-updater'] as { checkUpdates(): Promise<number> }
      await expect(updater.checkUpdates()).resolves.toBe(0)
      expect(shell.roster.get().some((row) => row.id === 'drawer-a')).toBe(false)
      expect(errSpy).toHaveBeenCalled()
    } finally {
      errSpy.mockRestore()
    }
  })

  it('远端 drawer chunk:add 行 → 抽屉 left cell 有胜出者;remove → 消失', async () => {
    const host = await makeHost()
    const shell = await boot(host.baseUrl)
    expect(shell.slots.resolveSlot(DRAWER_SLOT, DRAWER_LEFT)).toBeUndefined()

    const base = await serveRoutes({ '/drawer-a.client.js': () => leftDrawerChunk })
    shell.roster.add({
      id: 'drawer-a',
      module: 'drawer-a',
      remote: { url: `${base}/drawer-a.client.js`, rev: 'r1' },
    })
    await tick(40)

    const left = shell.slots.resolveSlot(DRAWER_SLOT, DRAWER_LEFT)
    expect(left).toBeTruthy()
    expect(left!.entry.component).toBeTruthy()

    shell.roster.remove('drawer-a')
    await tick(30)
    expect(shell.slots.resolveSlot(DRAWER_SLOT, DRAWER_LEFT)).toBeUndefined()
  })

  it('frame 存在性:MAIN_SLOT 隐式 cell 是整屏框架,body cell 是 chat', async () => {
    const host = await makeHost()
    const shell = await boot(host.baseUrl)

    // S0 契约:frame 占隐式 cell(priority -10),chat 占 body cell。
    const frameWinner = shell.slots.resolveSlot(MAIN_SLOT)
    expect(frameWinner).toBeTruthy()
    expect(frameWinner!.entry.component).toBeTruthy()
    expect(frameWinner!.priority).toBe(-10)

    const bodyWinner = shell.slots.resolveSlot(MAIN_SLOT, MAIN_BODY_KEY)
    expect(bodyWinner).toBeTruthy()
    expect(bodyWinner!.entry.component).toBeTruthy()
    expect(bodyWinner!.priority).toBe(0)
  })
})