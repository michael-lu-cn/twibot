import { Context } from '@deepseek-ai/cordis'
import { serve, type ServerType } from '@hono/node-server'
import { Hono } from 'hono'

/** HTTP server plugin: owns the Hono app and the listening socket. */
export const name = 'api-server'

/** Depends on the demo `hello` service to prove inject-driven activation. */
export const inject = ['hello']

export interface Config {
  /** HTTP port to listen on. */
  port: number
  /** Bind host. */
  host: string
}

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

  // 供后续插件注册自己的子路由：ctx.api.route(method, path, handler)
  ctx.provide('api', app)

  const server: ServerType = serve({ fetch: app.fetch, port: config.port, hostname: config.host })
  ctx.logger?.('api-server').info('listening on http://%s:%d', config.host, config.port)

  // 注册皆 effect：effect body 立即执行并【返回】disposer，卸载时才真正关闭监听
  ctx.effect(() => {
    return () => {
      server.close()
    }
  }, 'close-http-server')
}