/**
 * P2.2 drawer-settings 远端 chunk 验收:右抽屉槽位注册/卸载、plugin-updater
 * 缺失降级(防御式 ctx.get 不阻断注册)。
 *
 * 流程与 remote-chunk.test.ts 同款:serve 构建产物文本 → MockHost + boot →
 * roster.add remote 行 → tick 排空装配队列 → resolveSlot('drawer','right')。
 */
import { createServer, type Server } from 'node:http'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

import { boot } from '../src/index'
import { resetChunkCacheForTests } from '../src/script-loader'
import { MockHost } from '../../../packages/protocol-client/tests/mock-host'

/** 经 Context#get 防御式读服务(d.ts 索引签名遮蔽了 get 的签名,这里补上)。 */
function pluginUpdaterOf(shell: Awaited<ReturnType<typeof boot>>): unknown {
  return (shell.ctx as unknown as { get(name: string): unknown }).get('plugin-updater')
}

const hosts: MockHost[] = []
const servers: Server[] = []

/** drawer-settings 构建产物(相对本测试文件:apps/shell/tests → ../../remote-chunk-demo/dist)。 */
const CHUNK_PATH = fileURLToPath(
  new URL('../../remote-chunk-demo/dist/drawer-settings.client.js', import.meta.url),
)

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

/** 当前构建产物的文本快照(每次读取真实 dist,保证测的就是交付物)。 */
function chunkCode(): string {
  return readFileSync(CHUNK_PATH, 'utf8')
}

/** cordis 装配/卸载的 effect 回滚是异步链;增删行后排空定时器。 */
const tick = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms))

function componentOf(winner: { entry: { component: unknown } } | undefined): unknown {
  return winner?.entry && (winner.entry as { component: unknown }).component
}

describe('drawer-settings 远端 chunk(drawer/right 槽位)', () => {
  it('roster.add remote 行 → 注册到 drawer/right;remove 后注销', async () => {
    const host = new MockHost()
    await host.listen()
    hosts.push(host)
    const base = await serve(chunkCode())

    const shell = await boot(host.baseUrl)
    // 基线默认无任何 drawer 注册(S0:抽屉单价由远端/本地插件占有)。
    expect(shell.slots.resolveSlot('drawer', 'right')).toBeUndefined()

    shell.roster.add({
      id: 'drawer-settings',
      module: 'drawer-settings',
      remote: { url: `${base}/drawer-settings.client.js`, rev: 't1' },
    })
    await tick(50)

    const winner = shell.slots.resolveSlot('drawer', 'right')
    expect(winner).toBeTruthy()
    expect(typeof componentOf(winner)).toBe('function')
    expect((componentOf(winner) as { displayName?: string }).displayName).toBe('SettingsDrawer')

    // 卸载即回滚:remote 行移除 → 右抽屉清空。
    shell.roster.remove('drawer-settings')
    await tick(50)
    expect(shell.slots.resolveSlot('drawer', 'right')).toBeUndefined()
  })

  it('ui-frame 卸载后(plugin-updater 缺失)仍注册成功——取不到只降级 UI', async () => {
    const host = new MockHost()
    await host.listen()
    hosts.push(host)
    const base = await serve(chunkCode())

    const shell = await boot(host.baseUrl)
    // S1 起默认清单含 ui-frame(提供 plugin-updater);先确认在场,再卸下它,
    // 构造"更新服务缺失"环境——防御式 ctx.get 只降级 UI,不阻断注册。
    expect(pluginUpdaterOf(shell)).toBeTruthy()
    shell.roster.remove('ui-frame')
    await tick(80)
    expect(pluginUpdaterOf(shell)).toBeUndefined()

    shell.roster.add({
      id: 'drawer-settings',
      module: 'drawer-settings',
      remote: { url: `${base}/drawer-settings.client.js`, rev: 't2' },
    })
    await tick(50)

    const winner = shell.slots.resolveSlot('drawer', 'right')
    expect(winner).toBeTruthy()
    expect(typeof componentOf(winner)).toBe('function')
  })
})