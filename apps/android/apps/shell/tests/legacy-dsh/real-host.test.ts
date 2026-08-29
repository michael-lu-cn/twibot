/**
 * P0.5 设备档前置：插件树 × 真实 dsh 宿主（本机 dev 宿主或公网端点）。
 * 宿主不可达时整组跳过——Node 档功能验证已由 plugins.test.ts 覆盖。
 *
 * 通过标准对应 mvp-report 实验 2 + p05-plan 里程碑 C：
 * - send('你好') 收到真实模型非空回复
 * - 会话历史在服务端增长（reload 条数增加）
 */
import { describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'

import { boot } from '../src/index'
import type { SessionsService } from '../src/types'
import type { MinimalWebSocket } from '@twibot/face-protocol-client'

// 默认直连公网域名（与 App.tsx 的 DEFAULT_HOST 同源）；本机 dev 宿主用 DSH_HOST 覆盖。
const HOST = process.env.DSH_HOST ?? 'http://admin.dsh.port.dpdns.org'

const reachable = await fetch(`${HOST}/api/session.list`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ type: 'client-request', rpcId: 'rn-probe', method: 'session.list', payload: {} }),
  signal: AbortSignal.timeout(5000),
})
  .then((r) => r.ok)
  .catch(() => false)

// Node 全局 WebSocket（undici）可直连宿主双下行流；与 mock 档不同，这里不再注入 ws 包。
describe.skipIf(!reachable)(`P0.5 × 真实宿主 ${HOST}`, () => {
  it(
    'boot 插件树并完成一轮真实对话',
    { timeout: 60_000 },
    async () => {
      const shell = await boot(HOST)
      const sessions = shell.ctx.sessions as SessionsService

      const reply = await sessions.send('你好')
      console.log('[real-host] reply:', reply.slice(0, 120))
      expect(reply.trim().length).toBeGreaterThan(0)
      // 真实模型回复不应是客户端诊断串（prompt 空回复时的兜底格式）
      expect(reply.startsWith('[')).toBe(false)

      // 服务端历史确实增长：reload 能取到 ≥ 刚才两轮消息
      const restored = await sessions.reload()
      expect(restored).toBeGreaterThanOrEqual(2)

      shell.roster.remove('dsh-connection')
    },
  )
})

// 引用避免未使用告警（ws 工厂保留给需要显式注入的运行环境）。
void (WebSocket as unknown as MinimalWebSocket | undefined)
