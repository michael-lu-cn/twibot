/**
 * 插件：dsh-connection
 * inject: [] / provide: 'dsh'
 *
 * 创建 DshClient 并注册为 cordis 服务；卸载效果 = close()（停重连 + 关双流）。
 * 地址来自插件 config.baseUrl（boot 时经 ctx.plugin(plugin, { baseUrl }) 传入）。
 */
import { DshClient } from '@twibot/face-protocol-client'

import type { CordisPlugin } from '@twibot/face-cordis-kernel'

export interface ConnectionConfig {
  /** 绝对 http(s) 宿主地址。 */
  baseUrl: string
}

export const connectionPlugin: CordisPlugin = {
  name: 'dsh-connection',
  apply(ctx, rawConfig) {
    const config = (rawConfig ?? {}) as Partial<ConnectionConfig>
    if (typeof config.baseUrl !== 'string' || config.baseUrl === '') {
      throw new Error('dsh-connection requires config.baseUrl')
    }

    const client = new DshClient({
      baseUrl: config.baseUrl,
      timeouts: { streamOpenMs: 15000, unaryMs: 25000 },
    })

    ctx.provide('dsh', client)
    ctx.effect(() => () => client.close(), 'dsh-connection.close')
  },
}
