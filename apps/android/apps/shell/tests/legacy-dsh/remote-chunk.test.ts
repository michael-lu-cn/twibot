/**
 * P2.2 远端 chunk 通道:求值执行、rev 缓存、装配器集成(remote 行)。
 * Node 档走 fetch + new Function 通道(与设备档的原生 ScriptLoader 汇合于
 * 同一全局注册表 __face_plugins)。
 */
import { createServer, type Server } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'

import { boot, MAIN_SLOT } from '../src/index'
import { ensureChunkLoaded, resetChunkCacheForTests } from '../src/script-loader'
import { MAIN_BODY_KEY } from '../src/types'
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

/** 起一个只服务给定文本的小 HTTP 服务;返回 base url。 */
async function serve(body: string): Promise<string> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/javascript' })
    res.end(body)
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  return `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
}

const chunkCode = (marker: string) => `
(function (global) {
  global.__face_plugins = global.__face_plugins || {};
  global.__face_plugins['demo-panel'] = {
    mount: function (env) {
      function DemoPanel() { return env.React.createElement('demo', { marker: '${marker}' }) }
      DemoPanel.displayName = 'DemoPanel';
      return {
        name: 'demo-panel',
        inject: [],
        apply: function (ctx) {
          ctx.effect(function () {
            return env.slots.register('main', { component: DemoPanel }, { priority: -1, key: 'body' });
          }, 'demo-panel.slot(main/body)');
        },
      };
    },
  };
})(globalThis);
`

describe('ensureChunkLoaded', () => {
  it('下载并求值 chunk → 挂载面可用;rev 未变命中缓存不重复下载', async () => {
    const base = await serve(chunkCode('v1'))
    const spy = vi.spyOn(globalThis, 'fetch')

    const first = await ensureChunkLoaded('demo-panel', { url: `${base}/demo-panel.client.js`, rev: 'aaa' })
    expect(typeof first.mount).toBe('function')
    expect(spy).toHaveBeenCalledTimes(1)

    const second = await ensureChunkLoaded('demo-panel', { url: `${base}/demo-panel.client.js`, rev: 'aaa' })
    expect(second).toBe(first)
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })

  it('rev 变化 → 自然失效重新下载,拿到新内容', async () => {
    const base = await serve(chunkCode('v1'))
    const first = await ensureChunkLoaded('demo-panel', { url: `${base}/c.js`, rev: 'r1' })
    void first

    // 内容换新版本
    servers[0]!.close()
    servers.length = 0
    const base2 = await serve(chunkCode('v2'))
    const second = await ensureChunkLoaded('demo-panel', { url: `${base2}/c.js`, rev: 'r2' })
    const plugin = second.mount({
      slots: (() => {
        const rows: Array<{ entry: unknown }> = []
        return {
          register: (_slotId: string, entry: unknown) => {
            rows.push({ entry })
            return () => {}
          },
          __rows: rows,
        }
      })(),
      React,
      ReactNative: {},
    })
    expect(plugin).toMatchObject({ name: 'demo-panel' })
  })

  it('chunk 违约(未注册 __face_plugins)→ 大声抛错', async () => {
    const base = await serve('(function(g){ g.__nothing = 1 })(globalThis);')
    await expect(
      ensureChunkLoaded('ghost', { url: `${base}/ghost.client.js`, rev: 'r1' }),
    ).rejects.toThrow(/did not register/)
  })

  it('HTTP 非 2xx → 大声抛错', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(404).end()
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    await expect(
      ensureChunkLoaded('demo-panel', { url: `http://127.0.0.1:${port}/missing.js`, rev: 'r1' }),
    ).rejects.toThrow(/HTTP 404/)
  })
})

describe('装配器 × remote 行', () => {
  beforeEach(() => resetChunkCacheForTests())

  it('roster.add remote 行 → chunk 执行并占据 slot;remove 后消失', async () => {
    const host = new MockHost()
    await host.listen()
    hosts.push(host)
    host.scriptTexts.push('ok')
    const base = await serve(chunkCode('device-like'))

    const shell = await boot(host.baseUrl)
    expect(shell.slots.resolveSlot(MAIN_SLOT, MAIN_BODY_KEY)).toBeTruthy() // ui-chat 先占 body cell

    // ui-chat 让位后,remote 面板以更低 priority 胜出也可直接观察:
    shell.roster.remove('ui-chat')
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(shell.slots.resolveSlot(MAIN_SLOT, MAIN_BODY_KEY)).toBeUndefined()

    shell.roster.add({
      id: 'demo-panel',
      module: 'demo-panel',
      remote: { url: `${base}/demo-panel.client.js`, rev: 'r1' },
    })
    await new Promise((resolve) => setTimeout(resolve, 40))

    const winner = shell.slots.resolveSlot(MAIN_SLOT, MAIN_BODY_KEY)
    expect(winner).toBeTruthy()
    const Component = (winner!.entry as { component: { displayName?: string } }).component
    expect(Component.displayName).toBe('DemoPanel')

    // 卸载即回滚:P1 语义对 remote 行一视同仁。
    shell.roster.remove('demo-panel')
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(shell.slots.resolveSlot(MAIN_SLOT, MAIN_BODY_KEY)).toBeUndefined()
  })
})
