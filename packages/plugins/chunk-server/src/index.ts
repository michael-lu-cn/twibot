import { Context } from '@deepseek-ai/cordis'
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

/**
 * 远端插件 chunk 的静态宿主（P2.2 服务端半边）。
 *
 * 壳（apps/android）冷启动装本地基线，随后轮询本插件发的清单：
 *   GET <prefix>/manifest.json  → { ok, dir, generatedAt, entries: [{ id, url, rev, bytes }] }
 *   GET <prefix>/<name>.client.js → IIFE 代码（末尾注册 globalThis.__face_plugins['<name>']）
 * 清单**每次请求现扫目录**（rev = 文件 sha1 前 12 位），所以重建 chunk 之后
 * 不用重启 API、更不用重装 APK：壳发现 rev 变了就卸旧装新。
 *
 * 安全边界：路由只读 `config.dir` 下、文件名匹配 `^[A-Za-z0-9._-]+\.client\.js$`
 * 的文件（挡路径穿越）；chunk 本身是代码执行通道，服务端是信任域（见 readme 拓扑）。
 */
export const name = 'chunk-server'

/** 挂在 api-server 的 Hono 实例上（它 `ctx.provide('api', app)`）。 */
export const inject = ['api']

export interface Config {
  /** chunk 产物目录；相对路径按进程 cwd 解析，绝对路径直接用。缺省读 TWIBOT_CHUNK_DIR。 */
  dir: string
  /** 路由前缀，缺省 `/plugins`。 */
  prefix?: string
}

/** 清单里的一行（与壳侧 `plugin-sync.ts` 的 ManifestEntry 同构，id/url/rev 是契约）。 */
export interface ChunkEntry {
  /** 插件 id：壳只认自己本地模块表里的 id（信任名单）。 */
  id: string
  /** 相对前缀的路径，如 `/plugins/ui-router.client.js`。 */
  url: string
  /** 内容修订：文件 sha1 前 12 位。 */
  rev: string
  /** 字节数，方便人工核对。 */
  bytes: number
}

export interface Manifest {
  ok: true
  dir: string
  generatedAt: number
  entries: ChunkEntry[]
  note?: string
}

const FILE_PATTERN = /^([A-Za-z0-9._-]+)\.client\.js$/
const REV_LEN = 12

/** 内容修订算法：sha1 前 12 位（与壳侧的缓存键、`scripts/build-chunk.sh` 一致）。 */
export function chunkRev(code: Buffer | string): string {
  return createHash('sha1').update(code).digest('hex').slice(0, REV_LEN)
}

/** 规范化路由前缀：保证以 `/` 开头、不以 `/` 结尾。 */
export function normalizePrefix(raw?: string): string {
  const trimmed = (raw ?? '/plugins').trim()
  if (!trimmed) return '/plugins'
  const withLead = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  return withLead.endsWith('/') ? withLead.slice(0, -1) : withLead
}

/**
 * 扫目录生成清单条目（纯函数，便于单测）。目录不存在/不可读返回 `null`
 * —— 调用方据此回一份空清单而不是 500：没有 chunk 是合法状态（壳跑本地基线）。
 */
export async function scanChunks(dir: string, prefix = '/plugins'): Promise<ChunkEntry[] | null> {
  const base = normalizePrefix(prefix)
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return null
  }
  const entries: ChunkEntry[] = []
  for (const file of names.sort()) {
    const matched = FILE_PATTERN.exec(file)
    if (matched === null) continue
    let code: Buffer
    try {
      code = await readFile(join(dir, file))
    } catch {
      continue // 竞态：扫描间隙被删/被写，跳过即可（下次轮询再来）
    }
    entries.push({
      id: matched[1]!,
      url: `${base}/${file}`,
      rev: chunkRev(code),
      bytes: code.byteLength,
    })
  }
  return entries
}

/**
 * 谁在拉清单：优先 x-request-id，其次 user-agent；拿到不到就 '-'。
 * 真机没有可观测的 JS 日志，服务端这条记录是"手机到底来没来"的唯一现场；
 * 测试用的 Hono 替身没有 req.header，故这里必须容错。
 */
export function callerOf(c: unknown): string {
  const req = (c as { req?: { header?: unknown } } | undefined)?.req
  const header = req?.header
  if (typeof header !== 'function') return '-'
  try {
    const h = header as (key: string) => string | undefined
    return h.call(req, 'x-request-id') ?? h.call(req, 'user-agent') ?? '-'
  } catch {
    return '-'
  }
}

export function apply(ctx: Context, config: Config): void {
  const declared = (config?.dir ?? process.env['TWIBOT_CHUNK_DIR'] ?? '').trim()
  if (!declared) {
    throw new Error('chunk-server: 缺少 config.dir（chunk 产物目录），或设置 TWIBOT_CHUNK_DIR')
  }
  const dir = resolve(declared)
  const prefix = normalizePrefix(config?.prefix)
  const api = ctx.api as any
  // 直写控制台：当前宿主的 ctx.logger 不落 stdout，诊断信息会被吞掉，
  // 而这个插件的日志正是"手机有没有来取 chunk"的唯一现场。
  const log = (message: string): void => {
    console.log(`[chunk-server] ${message}`)
  }

  // 静态路径先注册，避免被 :file 抢先匹配。
  api.get(`${prefix}/manifest.json`, async (c: any) => {
    log(`manifest ← ${callerOf(c)}`)
    const entries = await scanChunks(dir, prefix)
    const body: Manifest = {
      ok: true,
      dir,
      generatedAt: Date.now(),
      entries: entries ?? [],
      ...(entries === null ? { note: `chunk 目录不存在或不可读: ${dir}` } : {}),
    }
    if (entries === null) log(`清单为空：目录不存在 ${dir}（先跑 scripts/build-chunk.sh）`)
    return c.json(body, 200, { 'cache-control': 'no-store' })
  })

  api.get(`${prefix}/:file`, async (c: any) => {
    const file = String(c.req.param('file') ?? '')
    if (!FILE_PATTERN.test(file)) {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: `文件名非法: ${file}` } }, 400)
    }
    let code: Buffer
    try {
      code = await readFile(join(dir, file))
    } catch {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: `chunk 不存在: ${file}` } }, 404)
    }
    log(`served ${file} (${code.byteLength}B, rev ${chunkRev(code)})`)
    return new Response(code, {
      status: 200,
      headers: {
        'content-type': 'application/javascript; charset=utf-8',
        // 壳自己按 rev 换版；HTTP 缓存只会帮倒忙（尤其局域网反向代理）。
        'cache-control': 'no-store',
        'access-control-allow-origin': '*',
      },
    })
  })

  ctx.effect(() => {
    log(`chunk 目录 ${dir}，清单 ${prefix}/manifest.json`)
    return () => {}
  }, 'chunk-server-routes')
}