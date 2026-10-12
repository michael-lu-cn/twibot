import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply, chunkRev, normalizePrefix, scanChunks, type Config } from './index'

/** 造一个临时 chunk 目录：两个合法 chunk + 若干应当被忽略的文件。 */
async function fixture(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'chunk-server-'))
  await writeFile(join(dir, 'ui-router.client.js'), 'globalThis.__face_plugins = {};\n')
  await writeFile(join(dir, 'ui-hello.client.js'), 'console.log("hello")\n')
  await writeFile(join(dir, 'readme.md'), '# 不是 chunk\n')
  await writeFile(join(dir, 'notes.js'), '// 缺 .client\n')
  await mkdir(join(dir, 'backup.client.js'), { recursive: true }) // 目录同名 → 读文件失败应跳过
  return dir
}

interface JsonReply {
  kind: 'json'
  body: any
  status: number
  headers?: Record<string, string>
}

/** 极简 Hono 替身：记录路由，并把 c.json / c.req.param 做成可断言的假体。 */
function fakeShell() {
  const routes = new Map<string, (c: any) => unknown>()
  const api = {
    get(path: string, handler: (c: any) => unknown) {
      routes.set(path, handler)
      return api
    },
  }
  const ctx = {
    api,
    logger: () => ({ info: () => undefined, warn: () => undefined }),
    effect: (fn: () => unknown) => {
      fn()
    },
  }
  const call = (path: string, params: Record<string, string> = {}): any => {
    const handler = routes.get(path)
    assert.ok(handler, `未注册路由 ${path}`)
    const reply: { current?: JsonReply } = {}
    const c = {
      get reply() {
        return reply.current
      },
      json(body: unknown, status = 200, headers?: Record<string, string>): JsonReply {
        reply.current = { kind: 'json', body, status, headers }
        return reply.current
      },
      req: { param: (key: string) => params[key] },
    }
    return { result: handler(c), c }
  }
  return { ctx, routes, call }
}

test('normalizePrefix：补前导斜杠、去尾斜杠、空值回落 /plugins', () => {
  assert.equal(normalizePrefix(undefined), '/plugins')
  assert.equal(normalizePrefix(''), '/plugins')
  assert.equal(normalizePrefix('plugins'), '/plugins')
  assert.equal(normalizePrefix('/plugins/'), '/plugins')
  assert.equal(normalizePrefix('/face/chunks'), '/face/chunks')
})

test('chunkRev：sha1 前 12 位（与 build-chunk.sh / 壳缓存键一致）', () => {
  assert.equal(chunkRev('abc'), 'a9993e364706')
  assert.match(chunkRev(Buffer.from('abc')), /^[0-9a-f]{12}$/)
  assert.notEqual(chunkRev('abc'), chunkRev('abd'))
})

test('scanChunks：只收 *.client.js，rev 对内容敏感，url 带前缀', async () => {
  const dir = await fixture()
  const entries = await scanChunks(dir)
  assert.ok(entries !== null)
  assert.deepEqual(
    entries.map((e) => e.id),
    ['ui-hello', 'ui-router'],
  )
  const router = entries.find((e) => e.id === 'ui-router')!
  assert.equal(router.url, '/plugins/ui-router.client.js')
  assert.equal(router.bytes, Buffer.byteLength('globalThis.__face_plugins = {};\n'))
  assert.equal(router.rev, chunkRev('globalThis.__face_plugins = {};\n'))

  // 改内容 → rev 必变（壳据此卸旧装新）
  await writeFile(join(dir, 'ui-router.client.js'), 'globalThis.__face_plugins = {};//v2\n')
  const again = await scanChunks(dir)
  assert.notEqual(again!.find((e) => e.id === 'ui-router')!.rev, router.rev)

  // 自定义前缀
  const prefixed = await scanChunks(dir, '/face/chunks')
  assert.equal(prefixed!.find((e) => e.id === 'ui-router')!.url, '/face/chunks/ui-router.client.js')
})

test('scanChunks：目录不存在返回 null（调用方回空清单，不 500）', async () => {
  assert.equal(await scanChunks(join(tmpdir(), 'chunk-server-缺失目录-xyz')), null)
})

test('apply：缺 config.dir 直接抛（配错要炸在启动期，不要静默）', () => {
  const { ctx } = fakeShell()
  assert.throws(() => apply(ctx as any, {} as Config), /缺少 config.dir/)
})

test('路由：manifest 现扫目录，返回 id/url/rev/bytes 契约', async () => {
  const dir = await fixture()
  const { ctx, routes, call } = fakeShell()
  apply(ctx as any, { dir, prefix: '/plugins' })
  assert.deepEqual([...routes.keys()], ['/plugins/manifest.json', '/plugins/:file'])

  const { result } = call('/plugins/manifest.json')
  const body = (await result) as JsonReply
  assert.equal(body.status, 200)
  assert.equal(body.headers?.['cache-control'], 'no-store')
  assert.equal(body.body.ok, true)
  assert.deepEqual(
    body.body.entries.map((e: any) => e.id),
    ['ui-hello', 'ui-router'],
  )
  assert.equal(body.body.dir, dir)
})

test('路由：目录缺失时 manifest 是 200 + 空清单 + note（壳静默回本地基线）', async () => {
  const { ctx, call } = fakeShell()
  apply(ctx as any, { dir: join(tmpdir(), 'chunk-server-不存在-abc') })
  const body = (await call('/plugins/manifest.json').result) as JsonReply
  assert.equal(body.status, 200)
  assert.deepEqual(body.body.entries, [])
  assert.match(body.body.note, /不存在/)
})

test('路由：合法 chunk 原样返回，非法文件名 400，缺失 404', async () => {
  const dir = await fixture()
  const { ctx, call } = fakeShell()
  apply(ctx as any, { dir })

  const hit = (await call('/plugins/:file', { file: 'ui-router.client.js' }).result) as Response
  assert.equal(hit.status, 200)
  assert.equal(hit.headers.get('content-type'), 'application/javascript; charset=utf-8')
  assert.equal(hit.headers.get('cache-control'), 'no-store')
  assert.equal(hit.headers.get('access-control-allow-origin'), '*')
  assert.equal(await hit.text(), 'globalThis.__face_plugins = {};\n')

  const bad = (await call('/plugins/:file', { file: '../cordis.yml' }).result) as JsonReply
  assert.equal(bad.status, 400)

  const miss = (await call('/plugins/:file', { file: 'nope.client.js' }).result) as JsonReply
  assert.equal(miss.status, 404)
})