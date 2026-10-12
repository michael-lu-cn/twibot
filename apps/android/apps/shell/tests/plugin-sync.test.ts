/**
 * P2.2 宿主清单 → roster 的远端化同步(plugin-sync)。
 *
 * 真起一个 HTTP 服务当宿主:manifest.json + *.client.js 都按 chunk-server 的
 * 契约返回,chunk 脚本走真实的 fetch + new Function 求值路径 —— 测的是壳里
 * 真正跑的那条链路(下载 → 求值 → 换行),不是替身。
 */
import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'

import { defaultRoster, createRosterStore, type RosterEntry } from '../src/roster'
import { fetchPluginManifest, startPluginSync, syncRemotePlugins } from '../src/plugin-sync'
import { resetChunkCacheForTests, getRemoteMount } from '../src/script-loader'
import type { Shell } from '../src/index'

const servers: Server[] = []

afterEach(() => {
  resetChunkCacheForTests()
  for (const server of servers) server.close()
  servers.length = 0
})

/** 与 build-chunk.sh 产物同款形状:IIFE + __face_plugins 注册行。 */
const chunkCode = (id: string, marker = 'v1') => `
(function () {
  globalThis.__face_plugins = globalThis.__face_plugins || {};
  globalThis.__face_plugins['${id}'] = {
    mount: function () { return { name: '${id}', apply: function () {}, marker: '${marker}' }; },
  };
})();
`

type Route = { status?: number; body: string; type?: string }

/** 起一个按路径表服务的宿主;返回 base url。路由对象可中途改 body 模拟发版。 */
async function serveRoutes(routes: Record<string, Route>): Promise<string> {
  const server = createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0] ?? ''
    const hit = routes[path]
    if (hit === undefined) {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end('{"ok":false}')
      return
    }
    res.writeHead(hit.status ?? 200, {
      'content-type': hit.type ?? (path.endsWith('.json') ? 'application/json' : 'application/javascript'),
    })
    res.end(hit.body)
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  return `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
}

/** 只带 roster + env 的壳替身(syncRemotePlugins 只用这两样)。 */
function fakeShell(baseUrl: string): Shell {
  const roster = createRosterStore(defaultRoster(baseUrl))
  return {
    roster,
    env: { React: {}, ReactNative: {}, AsyncStorage: {}, jsxRuntime: {} },
  } as unknown as Shell
}

const manifestOf = (...entries: Array<{ id: string; url: string; rev: string }>) =>
  JSON.stringify({ ok: true, dir: '/tmp/fake', generatedAt: 1, entries })

const rowOf = (shell: Shell, id: string): RosterEntry | undefined =>
  shell.roster.get().find((row) => row.id === id)

describe('syncRemotePlugins:清单 → roster 收敛', () => {
  it('清单里的行换成远端实现(本地基线 → remote)', async () => {
    const routes: Record<string, Route> = {
      '/plugins/manifest.json': { body: manifestOf({ id: 'ui-router', url: '/plugins/ui-router.client.js', rev: 'aaaa1111' }) },
      '/plugins/ui-router.client.js': { body: chunkCode('ui-router') },
    }
    const base = await serveRoutes(routes)
    const shell = fakeShell(base)

    expect(rowOf(shell, 'ui-router')?.remote).toBeUndefined()
    const result = await syncRemotePlugins(shell, base)

    expect(result).toMatchObject({ changed: ['ui-router'], restored: [], dropped: [], skipped: [], failed: [] })
    expect(rowOf(shell, 'ui-router')?.remote).toEqual({
      url: `${base}/plugins/ui-router.client.js`,
      rev: 'aaaa1111',
    })
    // 预热过:挂载面已在全局注册表里(装配器随后直接取用,不再二次下载)
    expect(getRemoteMount('ui-router')).toBeTruthy()
    // 远端行必须继承本地基线的 config:插件从 roster 行读 baseUrl,
    // 漏掉它会退回 10.0.2.2(模拟器专用),真机上界面会连不上后端。
    expect(rowOf(shell, 'ui-router')?.config).toEqual({ baseUrl: base })
  })

  it('同一 rev 再同步是幂等的(不重复换行)', async () => {
    const routes: Record<string, Route> = {
      '/plugins/manifest.json': { body: manifestOf({ id: 'ui-router', url: '/plugins/ui-router.client.js', rev: 'aaaa1111' }) },
      '/plugins/ui-router.client.js': { body: chunkCode('ui-router') },
    }
    const base = await serveRoutes(routes)
    const shell = fakeShell(base)
    await syncRemotePlugins(shell, base)
    const again = await syncRemotePlugins(shell, base)

    expect(again.changed).toEqual([])
    expect(again.failed).toEqual([])
  })

  it('rev 变了即换版(roster 行的 rev 跟着走)', async () => {
    const routes: Record<string, Route> = {
      '/plugins/manifest.json': { body: manifestOf({ id: 'ui-router', url: '/plugins/ui-router.client.js', rev: 'aaaa1111' }) },
      '/plugins/ui-router.client.js': { body: chunkCode('ui-router', 'v1') },
    }
    const base = await serveRoutes(routes)
    const shell = fakeShell(base)
    await syncRemotePlugins(shell, base)

    routes['/plugins/manifest.json']!.body = manifestOf({ id: 'ui-router', url: '/plugins/ui-router.client.js', rev: 'bbbb2222' })
    routes['/plugins/ui-router.client.js']!.body = chunkCode('ui-router', 'v2')
    const result = await syncRemotePlugins(shell, base)

    expect(result.changed).toEqual(['ui-router'])
    expect(rowOf(shell, 'ui-router')?.remote?.rev).toBe('bbbb2222')
    expect(getRemoteMount('ui-router')).toBeTruthy()
  })

  it('清单里撤掉 → 回退本地基线实现(界面继续可用)', async () => {
    const routes: Record<string, Route> = {
      '/plugins/manifest.json': { body: manifestOf({ id: 'ui-router', url: '/plugins/ui-router.client.js', rev: 'aaaa1111' }) },
      '/plugins/ui-router.client.js': { body: chunkCode('ui-router') },
    }
    const base = await serveRoutes(routes)
    const shell = fakeShell(base)
    await syncRemotePlugins(shell, base)

    routes['/plugins/manifest.json']!.body = manifestOf()
    const result = await syncRemotePlugins(shell, base)

    expect(result).toMatchObject({ changed: [], restored: ['ui-router'] })
    const row = rowOf(shell, 'ui-router')
    expect(row?.remote).toBeUndefined()
    expect(row?.config).toEqual({ baseUrl: base })
  })

  it('信任名单外的 id 只记账不装(清单是数据,能装哪些能力由壳定)', async () => {
    const routes: Record<string, Route> = {
      '/plugins/manifest.json': {
        body: manifestOf({ id: 'evil-plugin', url: '/plugins/evil-plugin.client.js', rev: 'deadbeef' }),
      },
      '/plugins/evil-plugin.client.js': { body: chunkCode('evil-plugin') },
    }
    const base = await serveRoutes(routes)
    const shell = fakeShell(base)
    const result = await syncRemotePlugins(shell, base)

    expect(result.skipped).toEqual(['evil-plugin'])
    expect(rowOf(shell, 'evil-plugin')).toBeUndefined()
    expect(getRemoteMount('evil-plugin')).toBeUndefined()
  })

  it('预热失败(404)保留现状,不把界面换成装不上的空白', async () => {
    const routes: Record<string, Route> = {
      '/plugins/manifest.json': { body: manifestOf({ id: 'ui-router', url: '/plugins/gone.client.js', rev: 'cccc3333' }) },
      // /plugins/gone.client.js 故意不注册 → 404
    }
    const base = await serveRoutes(routes)
    const shell = fakeShell(base)
    const result = await syncRemotePlugins(shell, base)

    expect(result.failed).toEqual(['ui-router'])
    expect(result.changed).toEqual([])
    const row = rowOf(shell, 'ui-router')
    expect(row?.remote).toBeUndefined()
    expect(row?.config).toEqual({ baseUrl: base })
  })

  it('宿主没有清单路由(404)时是空数组,不是错误', async () => {
    const base = await serveRoutes({})
    await expect(fetchPluginManifest(base, { quiet: true })).resolves.toEqual([])
  })

  it('startPluginSync:intervalMs=0 立即同步一次,onResult 收到收敛结果', async () => {
    const routes: Record<string, Route> = {
      '/plugins/manifest.json': { body: manifestOf({ id: 'ui-router', url: '/plugins/ui-router.client.js', rev: 'aaaa1111' }) },
      '/plugins/ui-router.client.js': { body: chunkCode('ui-router') },
    }
    const base = await serveRoutes(routes)
    const shell = fakeShell(base)
    const seen: string[][] = []
    const stop = startPluginSync(shell, base, {
      intervalMs: 0,
      onResult: (result) => seen.push(result.changed),
    })
    await new Promise((resolve) => setTimeout(resolve, 200))
    stop()

    expect(seen).toEqual([['ui-router']])
    expect(rowOf(shell, 'ui-router')?.remote?.rev).toBe('aaaa1111')
  })
})
