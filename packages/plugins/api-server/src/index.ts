import { Context } from '@deepseek-ai/cordis'
import { serve, type ServerType } from '@hono/node-server'
import { Hono } from 'hono'
import { ProxyAgent } from 'undici'

/** HTTP server plugin: owns the Hono app and the listening socket. */
export const name = 'api-server'

/** Depends on the demo `hello` service to prove inject-driven activation. */
export const inject = ['hello']

export interface Config {
  /** HTTP port to listen on. */
  port: number
  /** Bind host. */
  host: string
  /** 图片代理出口代理（pbs.twimg.com 直连不通时）；空串/缺省读 TWITTER_PROXY → HTTPS_PROXY。 */
  proxy?: string
}

/** 头像图片代理白名单（防 SSRF：只转发 X 图片域）。 */
const IMG_ALLOWED_HOSTS = new Set(['pbs.twimg.com', 'abs.twimg.com', 'video.twimg.com', 'pbs.twimg.com', 'cdn.syndication.twimg.com'])
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

export function apply(ctx: Context, config: Config): void {
  const app = new Hono()

  app.get('/api/health', (c) => c.json({ ok: true, uptime: process.uptime() }))
  app.get('/api/hello', (c) =>
    c.json({
      message: ctx.hello.message,
      mountedAt: ctx.hello.mountedAt,
    }),
  )
  app.get('/api/inspect', (c) => {
    // 运行时可观测：列出树里当前活着的插件与服务（M0 最小版）
    const entries = [...ctx.loader.entries()].map((e) => ({
      id: e.id,
      name: e.options.name,
      disabled: e.disabled ?? false,
    }))
    return c.json({ ok: true, entries })
  })

  // 头像/图片代理：浏览器直连 pbs.twimg.com 不通时，由后端经代理拉取转发。
  // 用法：GET /api/img-proxy?url=<encoded>
  const proxy =
    (config.proxy ?? '').trim() ||
    process.env['TWITTER_PROXY'] ||
    process.env['HTTPS_PROXY'] ||
    process.env['https_proxy'] ||
    undefined
  const dispatcher = proxy ? new ProxyAgent(proxy) : undefined

  app.get('/api/img-proxy', async (c) => {
    const raw = c.req.query('url') ?? ''
    let u: URL
    try {
      u = new URL(raw)
    } catch {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'url 参数非法' } }, 400)
    }
    if (u.protocol !== 'https:' || !IMG_ALLOWED_HOSTS.has(u.hostname)) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN', message: `不允许代理该域名: ${u.hostname}` } }, 403)
    }
    try {
      const res = await fetch(u, { dispatcher, headers: { 'user-agent': UA } })
      const type = res.headers.get('content-type') ?? 'application/octet-stream'
      return new Response(res.body, {
        status: res.status,
        headers: {
          'content-type': type,
          'cache-control': 'public, max-age=86400',
        },
      })
    } catch (e) {
      return c.json({ ok: false, error: { code: 'IMG_FETCH_FAILED', message: e instanceof Error ? e.message : String(e) } }, 502)
    }
  })

  // 供后续插件注册自己的子路由：ctx.api.route(method, path, handler)
  ctx.provide('api', app)

  const server: ServerType = serve({ fetch: app.fetch, port: config.port, hostname: config.host })
  ctx.logger?.('api-server').info('listening on http://%s:%d', config.host, config.port)

  // 注册皆 effect：effect body 立即执行并【返回】disposer，卸载时才真正关闭监听
  ctx.effect(() => {
    return () => {
      server.close()
      dispatcher?.close()
    }
  }, 'close-http-server')
}