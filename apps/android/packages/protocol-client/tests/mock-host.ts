/**
 * 实验 2 集成测试用忠实 mock host：按真实宿主的 wire 行为实现。
 * 关键保真点（与源码一致）：
 * - 业务错误 = HTTP 200 + ServerResponse{result.ok=false}；只有载体故障才是非 2xx
 * - 下行帧全部是 ServerRequest 信封（method = payload.type）
 * - mux 连接即自动推送既有会话的 session/subscribed 基线
 * - 客户端在 WS 上发任何消息 → close(1008, 'downlink only')
 * - /api/respond 校验 pending 表；未决回执 {accepted:false, reason:'not-pending'}
 */
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { WebSocketServer, type WebSocket } from 'ws'

interface MockEvent {
  seq: number
  time: number
  type: string
  data: Record<string, unknown>
}

export interface ApprovalCall {
  rpcId: string
  sessionId: string
  approvalId: string
  toolName: string
}

export class MockHost {
  private server = http.createServer()
  private muxWss = new WebSocketServer({ noServer: true })
  private hostWss = new WebSocketServer({ noServer: true })
  private muxClients = new Set<WebSocket>()
  private hostClients = new Set<WebSocket>()

  private nextEventSeq = new Map<string, number>()
  readonly logs = new Map<string, MockEvent[]>()
  /** 每轮 prompt 的 assistant 最终文本脚本（队列消费）。 */
  scriptTexts: string[] = []
  /** 待下发审批（下次 prompt 时随事件流发出）。 */
  pendingApprovals: Array<{ sessionId: string; approvalId: string; toolName: string }> = []
  /** 已收到的 /api/respond 应答记录。 */
  readonly approvalResponses: Array<{ rpcId: string; body: Record<string, unknown> }> = []
  /**
   * pluginInventory.list 的应答条目;null(默认)= 模拟未实现该方法的旧宿主
   * (路由按未知方法抛错,供客户端降级路径测试)。
   */
  inventory: Array<Record<string, unknown>> | null = null
  /** GET / 的应答页面(用于模拟宿主 index 注入 __DSH_BOOT__);null = 405。 */
  rootHtml: string | null = null
  private pendingServerRequests = new Set<string>()
  private srvCounter = 0
  private url = ''

  async listen(): Promise<string> {
    this.server.on('request', (req, res) => void this.handleRequest(req, res))
    this.server.on('upgrade', (req, socket, head) => {
      const pathname = req.url?.split('?')[0]
      const wss = pathname === '/api/events.mux' ? this.muxWss : pathname === '/api/events.host' ? this.hostWss : null
      if (!wss) {
        socket.destroy()
        return
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        // 真实宿主姿态：mux 连接即推基线帧
        if (wss === this.muxWss) {
          for (const [sessionId] of this.logs) {
            this.sendFrame(ws, {
              type: 'session/subscribed',
              sessionId,
              lastSeq: (this.nextEventSeq.get(sessionId) ?? 0),
            })
          }
          this.muxClients.add(ws)
        } else {
          this.hostClients.add(ws)
        }
        ws.on('close', () => {
          this.muxClients.delete(ws)
          this.hostClients.delete(ws)
        })
        // 保真：下行 only —— 客户端任何消息都被 1008 关闭
        ws.on('message', () => ws.close(1008, 'downlink only'))
      })
    })
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve))
    const addr = this.server.address() as AddressInfo
    this.url = `http://127.0.0.1:${addr.port}`
    return this.url
  }

  close(): void {
    for (const ws of [...this.muxClients, ...this.hostClients]) ws.close(1001, 'mock shutdown')
    this.server.close()
    this.muxWss.close()
    this.hostWss.close()
  }

  get baseUrl(): string {
    return this.url
  }

  /** 模拟网络故障：掐断全部下行流。 */
  dropWebSockets(): void {
    for (const ws of [...this.muxClients, ...this.hostClients]) {
      ws.terminate()
    }
    this.muxClients.clear()
    this.hostClients.clear()
  }

  // ---- HTTP 路由 ----

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const pathname = req.url?.split('?')[0] ?? ''
    if (req.method === 'GET' && pathname === '/' && this.rootHtml !== null) {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(this.rootHtml)
      return
    }
    if (req.method !== 'POST' || !pathname.startsWith('/api/')) {
      res.writeHead(405).end()
      return
    }
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    let envelope: Record<string, unknown>
    try {
      envelope = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
    } catch {
      res.writeHead(400).end()
      return
    }
    const rpcId = String(envelope['rpcId'] ?? '')
    const method = pathname.slice('/api/'.length)

    if (method === 'respond') {
      const known = this.pendingServerRequests.has(rpcId)
      this.pendingServerRequests.delete(rpcId)
      this.approvalResponses.push({ rpcId, body: envelope['result'] as Record<string, unknown> })
      this.reply(res, rpcId, known ? { accepted: true } : { accepted: false, reason: 'not-pending' })
      return
    }

    try {
      const value = this.route(method, (envelope['payload'] ?? {}) as Record<string, unknown>)
      this.reply(res, rpcId, value)
    } catch (error) {
      // 业务错误：HTTP 200 + result.ok=false（与真实宿主一致）
      const e = error as { code?: string; message?: string }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          type: 'server-response',
          rpcId,
          result: { ok: false, error: { code: e.code ?? 'internal', message: e.message ?? 'mock error', details: null } },
        }),
      )
    }
  }

  private route(method: string, payload: Record<string, unknown>): unknown {
    switch (method) {
      case 'session.create': {
        const sessionId =
          typeof payload['sessionId'] === 'string' && payload['sessionId'] !== ''
            ? (payload['sessionId'] as string)
            : `sess-${this.logs.size + 1}`
        if (!this.logs.has(sessionId)) {
          this.logs.set(sessionId, [])
          this.nextEventSeq.set(sessionId, 0)
        }
        return { sessionId }
      }
      case 'session.prompt':
        return this.handlePrompt(payload as { sessionId: string; content: Array<{ type: string; text?: string }> })
      case 'session.history':
        return this.handleHistory(payload as { sessionId: string; beforeSeq?: number; maxMessages?: number })
      case 'session.list':
        return {
          items: [...this.logs.entries()].map(([sessionId, events]) => ({
            sessionId,
            updatedAt: events.length > 0 ? (events[events.length - 1]?.time ?? Date.now()) : Date.now(),
            running: false,
            blank: !events.some((event) => event.type === 'user/message'),
          })),
        }
      case 'pluginInventory.list': {
        if (this.inventory === null) {
          throw Object.assign(new Error('unknown mock method pluginInventory.list'), { code: 'not-found' })
        }
        return { entries: this.inventory }
      }
      default:
        throw Object.assign(new Error(`unknown mock method ${method}`), { code: 'not-found' })
    }
  }

  private handlePrompt(payload: { sessionId: string; content: Array<{ type: string; text?: string }> }): unknown {
    const sessionId = payload.sessionId
    const log = this.logs.get(sessionId)
    if (!log) throw Object.assign(new Error('no such session'), { code: 'no-such-session' })
    const userText = payload.content.find((part) => part.type === 'text')?.text ?? ''
    this.pushEvent(sessionId, { type: 'user/message', data: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: userText }] } })

    const finalText = this.scriptTexts.shift() ?? `echo:${userText}`

    setImmediate(() => {
      const approval = this.pendingApprovals.find((a) => a.sessionId === sessionId)
      if (approval) {
        this.pendingApprovals = this.pendingApprovals.filter((a) => a !== approval)
        const rpcId = this.nextSrvId()
        this.pendingServerRequests.add(rpcId)
        this.broadcastMux(this.envelope(rpcId, { type: 'approval/requested', sessionId, approvalId: approval.approvalId, toolName: approval.toolName }))
      }
      this.pushEvent(sessionId, { type: 'assistant/chunk', data: { chunk: { type: 'text-delta', index: 0, text: finalText.slice(0, 3) } } })
      this.pushEvent(sessionId, { type: 'assistant/chunk', data: { chunk: { type: 'text-delta', index: 1, text: finalText.slice(3) } } })
      this.pushEvent(sessionId, {
        type: 'assistant/message',
        data: { message: { role: 'assistant', content: [{ type: 'text', text: finalText }] } },
      })
      this.broadcastHost(this.envelope(this.nextSrvId(), { type: 'host/session-status', sessionId, running: false }))
    })
    return { accepted: true }
  }

  private handleHistory(payload: { sessionId: string; beforeSeq?: number; maxMessages?: number }): unknown {
    const all = this.logs.get(payload.sessionId)
    if (!all) throw Object.assign(new Error('no such session'), { code: 'no-such-session' })
    const cap = payload.maxMessages ?? 500
    const eligible = payload.beforeSeq === undefined ? all : all.filter((event) => event.seq < (payload.beforeSeq as number))
    const window = eligible.slice(-cap)
    return {
      events: window.map((event) => ({ event })),
      hasMore: eligible.length > window.length,
    }
  }

  // ---- 帧工具 ----

  private nextSrvId(): string {
    this.srvCounter += 1
    return `srv-${this.srvCounter}`
  }

  private envelope(rpcId: string, frame: Record<string, unknown>): Record<string, unknown> {
    return { type: 'server-request', rpcId, method: frame['type'], payload: frame }
  }

  private pushEvent(sessionId: string, partial: { type: string; data: Record<string, unknown> }): void {
    const log = this.logs.get(sessionId)!
    const seq = (this.nextEventSeq.get(sessionId) ?? 0) + 1
    this.nextEventSeq.set(sessionId, seq)
    const event: MockEvent = { seq, time: Date.now(), type: partial.type, data: partial.data }
    log.push(event)
    this.broadcastMux(this.envelope(this.nextSrvId(), { type: 'session/event', sessionId, event }))
  }

  private broadcastMux(payload: Record<string, unknown>): void {
    const line = JSON.stringify(payload)
    for (const ws of this.muxClients) {
      if (ws.readyState === ws.OPEN) ws.send(line)
    }
  }

  private broadcastHost(payload: Record<string, unknown>): void {
    const line = JSON.stringify(payload)
    for (const ws of this.hostClients) {
      if (ws.readyState === ws.OPEN) ws.send(line)
    }
  }

  private sendFrame(ws: WebSocket, frame: Record<string, unknown>): void {
    ws.send(JSON.stringify(this.envelope(this.nextSrvId(), frame)))
  }

  private reply(res: http.ServerResponse, rpcId: string, value: unknown): void {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ type: 'server-response', rpcId, result: { ok: true, value } }))
  }
}
