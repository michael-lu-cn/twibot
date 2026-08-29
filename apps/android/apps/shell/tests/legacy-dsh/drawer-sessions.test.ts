/**
 * S1 并行开发:drawer-sessions 远端 chunk 的装配集成测试。
 *
 * 读构建产物 apps/remote-chunk-demo/dist/drawer-sessions.client.js 的文本,
 * 用本地 http server serve(仿 remote-chunk.test.ts 的 serve()):
 * chunk 若有未定义标识符会在 new Function 求值时报错——本文件首个断言
 * 就是装载能跑通(先别谈渲染)。
 *
 * 用例线:MockHost + boot(宿主 rootHtml=null → 回退本地基线)→
 * roster.add remote 行 → chunk 执行并占据 drawer/left → remove → 卸载回滚。
 */
import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

import { boot } from '../src/index'
import { resetChunkCacheForTests } from '../src/script-loader'
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

const tick = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms))

/** 本测试要验证的构建产物(相对本文件 src 上两级到 apps/)。 */
const CHUNK_PATH = fileURLToPath(
  new URL('../../remote-chunk-demo/dist/drawer-sessions.client.js', import.meta.url),
)

describe('drawer-sessions remote chunk', () => {
  it('装载远端 chunk → 占据 drawer/left;移除 → 卸载回滚', async () => {
    const chunkCode = readFileSync(CHUNK_PATH, 'utf8')
    expect(chunkCode.length).toBeGreaterThan(0)

    const host = new MockHost()
    await host.listen()
    hosts.push(host)
    const base = await serve(chunkCode)

    const shell = await boot(host.baseUrl)
    // 基线无人占据左抽屉;remote 行进场前应无 keyed cell 'left' 胜出者。
    expect(shell.slots.resolveSlot('drawer', 'left')).toBeUndefined()

    shell.roster.add({
      id: 'drawer-sessions',
      module: 'drawer-sessions',
      remote: { url: `${base}/drawer-sessions.client.js`, rev: 't1' },
    })
    await tick(50)

    // chunk 求值成功(未因未定义标识符抛错)且注册占据了 drawer/left。
    const winner = shell.slots.resolveSlot('drawer', 'left')
    expect(winner).toBeTruthy()
    expect(typeof (winner!.entry as { component: unknown }).component).toBe('function')

    // 卸载即回滚:P1 语义对 remote 行一视同仁。
    shell.roster.remove('drawer-sessions')
    await tick(50)
    expect(shell.slots.resolveSlot('drawer', 'left')).toBeUndefined()
  })
})