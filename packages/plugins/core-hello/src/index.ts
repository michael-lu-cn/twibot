import { Context } from '@deepseek-ai/cordis'

/** Demo service supplied by this plugin; consumers declare `inject: ['hello']`. */
export interface HelloService {
  /** Greeting shipped from the plugin tree. */
  message: string
  /** Time the tree mounted, for lifecycle probes. */
  mountedAt: number
}

export const name = 'core-hello'

export function apply(ctx: Context): void {
  const service: HelloService = { message: 'hello from twibot plugin tree', mountedAt: Date.now() }
  ctx.provide('hello', service)
}