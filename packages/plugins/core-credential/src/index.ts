import { Context } from '@deepseek-ai/cordis'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 单个 cookie（Playwright 可用形状的子集）。 */
export interface CredentialCookie {
  name: string
  value: string
  domain: string
  path: string
  httpOnly?: boolean
  secure?: boolean
  sameSite?: 'Strict' | 'Lax' | 'None'
}

/** cookie 源：env（TWITTER_COOKIES）/ 文件（data/credential.cookie）/ CDP。 */
export type CredentialSource = 'env' | 'file' | 'cdp' | 'none'

export interface CredentialService {
  /** 当前状态（不回显 cookie 值）。 */
  status(): { configured: boolean; keys: string[]; source: CredentialSource }
  /** 保存用户粘贴的 cookie（三格式），持久化到文件；无效抛 BAD_CREDENTIAL 语义的错误。 */
  save(raw: string): { keys: string[] }
  /** 删除文件凭据（env/cdp 不受影响）。 */
  clear(): void
  /** 解析后的 cookie 列表（env 优先，其次文件）。 */
  resolveCookies(): CredentialCookie[]
  /** cookie 头兼容串（Playwright context.addCookies 之外的会话使用）。 */
  resolveHeader(): string | null
  /** 是否具备关键键（auth_token + ct0）。 */
  hasRequired(): boolean
}

export const name = 'core-credential'
export const inject = ['api']

export interface Config {
  /** 持久化文件路径（相对 cwd 或绝对）。 */
  file: string
}

const REQUIRED_KEYS = ['auth_token', 'ct0'] as const

/** “无法解析/缺键”业务错误，路由层转 400 BAD_CREDENTIAL。 */
export class BadCredentialError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BadCredentialError'
  }
}

/** 解析用户粘贴内容 → cookie 列表。支持：cookie 头串 / cURL 文本 / JSON 数组。 */
export function parseCookieInput(raw: string): CredentialCookie[] {
  const s = raw.trim()
  if (!s) throw new BadCredentialError('cookie 内容为空')

  // 1) JSON 数组
  if (s.startsWith('[')) {
    try {
      const arr = JSON.parse(s) as Array<Record<string, unknown>>
      return arr.map((c) => ({
        name: String(c.name ?? ''),
        value: String(c.value ?? ''),
        domain: String(c.domain ?? '.x.com'),
        path: String(c.path ?? '/'),
        httpOnly: Boolean(c.httpOnly),
        secure: c.secure === undefined ? true : Boolean(c.secure),
        sameSite: (c.sameSite as CredentialCookie['sameSite']) ?? 'Lax',
      }))
    } catch {
      throw new BadCredentialError('cookie JSON 数组解析失败')
    }
  }

  // 2) cURL 文本：取 -H 'cookie: ...'，退而求其次 -b '...'
  const h = s.match(/-H ['"]cookie: ([^'"]+)['"]/i)
  if (h) return parseHeader(h[1]!)
  const b = s.match(/-b '([^']*)'/)
  if (b) return parseHeader(b[1]!)

  // 3) cookie 头串：k=v; k2=v2
  return parseHeader(s)
}

/** k=v; k2=v2 → cookie 列表。 */
export function parseHeader(header: string): CredentialCookie[] {
  const out: CredentialCookie[] = []
  for (const pair of header.split(';')) {
    const p = pair.trim()
    if (!p) continue
    const eq = p.indexOf('=')
    if (eq <= 0) continue
    out.push({
      name: p.slice(0, eq).trim(),
      value: p.slice(eq + 1).trim(),
      domain: '.x.com',
      path: '/',
      httpOnly: false,
      secure: true,
      sameSite: 'Lax',
    })
  }
  return out
}

export function apply(ctx: Context, config: Config): void {
  const file = config.file
  mkdirSync(dirname(file), { recursive: true })

  const resolveSource = (): CredentialSource => {
    if (process.env['TWITTER_CDP_URL']) return 'cdp'
    if (process.env['TWITTER_COOKIES']?.trim() && !process.env['TWITTER_COOKIES'].includes('[paste #')) return 'env'
    return existsSync(file) ? 'file' : 'none'
  }

  const readFileCookies = (): CredentialCookie[] | null => {
    if (!existsSync(file)) return null
    try {
      return parseCookieInput(readFileSync(file, 'utf8'))
    } catch {
      return null
    }
  }

  const service: CredentialService = {
    status() {
      const source = resolveSource()
      let keys: string[] = []
      if (source === 'env') keys = parseHeader(process.env['TWITTER_COOKIES']!).map((c) => c.name)
      else if (source === 'file') keys = readFileCookies()?.map((c) => c.name) ?? []
      return { configured: source !== 'none', keys, source }
    },

    save(raw) {
      const cookies = parseCookieInput(raw)
      const names = new Set(cookies.map((c) => c.name))
      const missing = REQUIRED_KEYS.filter((k) => !names.has(k))
      if (missing.length > 0) {
        throw new BadCredentialError(`缺少必需 cookie: ${missing.join(', ')}`)
      }
      writeFileSync(file, raw.trim() + '\n', 'utf8')
      return { keys: [...names] }
    },

    clear() {
      if (existsSync(file)) writeFileSync(file, '', 'utf8')
    },

    resolveCookies() {
      const env = process.env['TWITTER_COOKIES']
      if (env?.trim() && !env.includes('[paste #')) return parseHeader(env)
      return readFileCookies() ?? []
    },

    resolveHeader() {
      const cookies = this.resolveCookies()
      if (cookies.length === 0) return null
      return cookies.map((c) => `${c.name}=${c.value}`).join('; ')
    },

    hasRequired() {
      const names = new Set(this.resolveCookies().map((c) => c.name))
      return REQUIRED_KEYS.every((k) => names.has(k))
    },
  }

  ctx.provide('credential', service)

  // 端点：注册到 api-server 提供的 Hono app
  const api = ctx.api as any
  if (api) {
    api.post('/api/credential', async (c) => {
      let body: { cookie?: string } = {}
      try {
        body = await c.req.json()
      } catch {
        return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: '请求体需为 JSON：{ cookie }' } }, 400)
      }
      try {
        const result = service.save(String(body.cookie ?? ''))
        return c.json({ ok: true, data: { configured: true, keys: result.keys }, source: 'file', elapsedMs: 0 })
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        return c.json({ ok: false, error: { code: 'BAD_CREDENTIAL', message } }, 400)
      }
    })

    api.get('/api/credential/status', (c) => {
      const st = service.status()
      return c.json({ ok: true, data: st, source: 'credential', elapsedMs: 0 })
    })

    api.delete('/api/credential', (c) => {
      service.clear()
      return c.json({ ok: true, data: { deleted: true }, source: 'credential', elapsedMs: 0 })
    })
  }
}