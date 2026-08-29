/**
 * P2.3 持久化 chunk 缓存:存储命中跳网络 / rev 失效重拉并写回 / 存储故障回退。
 *
 * 内存 Map 仍是快路径;持久化只在冷启动(空内存)时被查询。存储面用
 * AsyncStorage 兼容子集(ChunkStore),这里注入内存实现并观测读写调用。
 */
import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  chunkFetchCountForTests,
  ensureChunkLoaded,
  resetChunkCacheForTests,
  setChunkStore,
} from '../src/script-loader'

const servers: Server[] = []

afterEach(() => {
  resetChunkCacheForTests()
  for (const server of servers) server.close()
  servers.length = 0
  vi.restoreAllMocks()
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

/** 与 remote-chunk.test.ts 同款 chunk 形状:注册 demo-panel 挂载面。 */
const chunkCode = (marker: string) => `
(function (global) {
  global.__face_plugins = global.__face_plugins || {};
  global.__face_plugins['demo-panel'] = {
    mount: function (env) {
      return {
        name: 'demo-panel',
        inject: [],
        apply: function (ctx) {
          ctx.effect(function () {
            return env.slots.register('main', { marker: '${marker}' }, { priority: -1 });
          }, 'demo-panel.slot(main)');
        },
      };
    },
  };
})(globalThis);
`

/** 可观测的内存存储:记录 reads/writes,可注入读写故障。 */
function memoryStore(opts: { failReads?: boolean; failWrites?: boolean } = {}) {
  const data = new Map<string, string>()
  const reads: string[] = []
  const writes: string[] = []
  const store = {
    data,
    reads,
    writes,
    async getItem(key: string): Promise<string | null> {
      if (opts.failReads) throw new Error('store read down')
      reads.push(key)
      return data.get(key) ?? null
    },
    async setItem(key: string, value: string): Promise<void> {
      if (opts.failWrites) throw new Error('store write down')
      writes.push(key)
      data.set(key, value)
    },
  }
  return store
}

describe('持久化 chunk 缓存', () => {
  it('存储命中:冷启动(空内存)不发出网络请求,直接挂载', async () => {
    const base = await serve(chunkCode('v1'))
    const url = `${base}/demo-panel.client.js`
    const key = `${url}@r1`
    const store = memoryStore()
    store.data.set(key, chunkCode('v1'))
    setChunkStore(store)

    const mount = await ensureChunkLoaded('demo-panel', { url, rev: 'r1' })
    expect(mount).toBeTruthy()
    expect(chunkFetchCountForTests()).toBe(0)
    expect(store.reads).toEqual([key])
  })

  it('rev 变化:忽略陈旧存储键,重新下载并写回新键', async () => {
    const base = await serve(chunkCode('v2'))
    const url = `${base}/demo-panel.client.js`
    const store = memoryStore()
    store.data.set(`${url}@r1`, chunkCode('v1'))
    setChunkStore(store)

    const mount = await ensureChunkLoaded('demo-panel', { url, rev: 'r2' })
    expect(mount).toBeTruthy()
    expect(chunkFetchCountForTests()).toBe(1)
    // 陈旧键保留(rev 变更即废弃,清理属 P3);新键已写回。
    expect(store.data.get(`${url}@r1`)).toBe(chunkCode('v1'))
    expect(store.data.get(`${url}@r2`)).toBe(chunkCode('v2'))
  })

  it('内存命中优先:同进程同 rev 第二次加载不再读存储', async () => {
    const base = await serve(chunkCode('v1'))
    const url = `${base}/demo-panel.client.js`
    const store = memoryStore()
    setChunkStore(store)

    await ensureChunkLoaded('demo-panel', { url, rev: 'r1' })
    await ensureChunkLoaded('demo-panel', { url, rev: 'r1' })
    expect(chunkFetchCountForTests()).toBe(1)
    expect(store.reads).toHaveLength(1)
  })

  it('存储读故障:回退网络,本次挂载不受影响', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const base = await serve(chunkCode('v1'))
    const url = `${base}/demo-panel.client.js`
    setChunkStore(memoryStore({ failReads: true }))

    const mount = await ensureChunkLoaded('demo-panel', { url, rev: 'r1' })
    expect(mount).toBeTruthy()
    expect(chunkFetchCountForTests()).toBe(1)
  })

  it('存储写故障:挂载成功,仅留内存缓存', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const base = await serve(chunkCode('v1'))
    const url = `${base}/demo-panel.client.js`
    setChunkStore(memoryStore({ failWrites: true }))

    const mount = await ensureChunkLoaded('demo-panel', { url, rev: 'r1' })
    expect(mount).toBeTruthy()
    expect(chunkFetchCountForTests()).toBe(1)
    // 写回失败不代表后续请求重下:内存缓存仍在。
    await ensureChunkLoaded('demo-panel', { url, rev: 'r1' })
    expect(chunkFetchCountForTests()).toBe(1)
  })

  it('无存储装配(默认):行为与纯内存档完全一致', async () => {
    const base = await serve(chunkCode('v1'))
    const url = `${base}/demo-panel.client.js`

    const mount = await ensureChunkLoaded('demo-panel', { url, rev: 'r1' })
    expect(mount).toBeTruthy()
    expect(chunkFetchCountForTests()).toBe(1)
    await ensureChunkLoaded('demo-panel', { url, rev: 'r1' })
    expect(chunkFetchCountForTests()).toBe(1)
  })
})