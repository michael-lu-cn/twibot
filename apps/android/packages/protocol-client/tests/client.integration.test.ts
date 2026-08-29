/**
 * 实验 2 集成测试：DshClient × MockHost（忠实 wire 行为）。
 * 通过标准对应计划 §9 实验 2：回复上屏 / 审批应答回显 rpcId / 断线重开流 + 整页拉取。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { DshClient, type DshClientOptions, type MinimalWebSocket } from '../src/client'
import { MockHost } from './mock-host'

const wsFactory = (url: string): MinimalWebSocket => new WebSocket(url) as unknown as MinimalWebSocket

const hosts: MockHost[] = []
const clients: DshClient[] = []

async function makeHost(): Promise<MockHost> {
  const host = new MockHost()
  await host.listen()
  hosts.push(host)
  return host
}

function makeClient(baseUrl: string, opts?: Omit<Partial<DshClientOptions>, 'baseUrl'>): DshClient {
  const client = new DshClient({ baseUrl, webSocketFactory: wsFactory, ...opts })
  clients.push(client)
  return client
}

async function waitFor<T>(probe: () => T | undefined | false | null, ms = 3000): Promise<T> {
  const deadline = Date.now() + ms
  for (;;) {
    const value = probe()
    if (value !== undefined && value !== false && value !== null) return value
    if (Date.now() > deadline) throw new Error('waitFor timeout')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

afterEach(() => {
  for (const client of clients) client.close()
  clients.length = 0
  for (const host of hosts) host.close()
  hosts.length = 0
})

describe('实验 2：信封协议客户端', () => {
  it('T1 对话上屏：prompt 收敛后拿到最终 assistant 文本与事件流', async () => {
    const host = await makeHost()
    host.scriptTexts.push('你好，我是 mock 助手。')
    const client = makeClient(host.baseUrl)
    await client.connect()

    const { sessionId } = await client.startSession()
    const { text, events } = await client.prompt(sessionId, '你好')

    expect(text).toBe('你好，我是 mock 助手。')
    const types = events.map((event) => event.type)
    expect(types).toContain('user/message')
    expect(types.filter((type) => type === 'assistant/chunk')).toHaveLength(2)
    expect(types).toContain('assistant/message')
  });

  it('T2 审批缺省 fail-closed：无 answerer 时自动回 rejected 且 rpcId 回显', async () => {
    const host = await makeHost()
    host.scriptTexts.push('done')
    host.pendingApprovals.push({ sessionId: '', approvalId: 'apr-1', toolName: 'bash' })
    // pendingApprovals 的 sessionId 在 route 时才知道 —— 手动补：
    // （MockHost.handlePrompt 按 sessionId 匹配，这里先建会话再改写）
    const client = makeClient(host.baseUrl)
    await client.connect()
    const { sessionId } = await client.startSession()
    host.pendingApprovals[0]!.sessionId = sessionId

    await client.prompt(sessionId, '跑个命令')

    const record = await waitFor(() => host.approvalResponses.find((r) => r.body !== undefined))
    expect(record.rpcId).toMatch(/^srv-/)
    const value = (record.body as { value?: { outcome?: string; approvalId?: string } }).value ?? {}
    expect(value.outcome).toBe('rejected')
    expect(value.approvalId).toBe('apr-1')
  })

  it('T3 审批注入 answerer：allowed-once 决策送达宿主', async () => {
    const host = await makeHost()
    host.scriptTexts.push('ok')
    const client = makeClient(host.baseUrl, {
      approvalAnswerer: (info) => (info.kind === 'approval' && info.toolName === 'bash' ? 'allowed-once' : 'rejected'),
    })
    await client.connect()
    const { sessionId } = await client.startSession()
    host.pendingApprovals.push({ sessionId, approvalId: 'apr-2', toolName: 'bash' })

    await client.prompt(sessionId, '允许我执行')

    const record = await waitFor(() => host.approvalResponses.find((r) => r.body !== undefined))
    const value = (record.body as { value?: { outcome?: string } }).value ?? {}
    expect(value.outcome).toBe('allowed-once')
  })

  it('T4 断线恢复：重开双流触发 onReconnect；history 整页拉到全量升序事件', async () => {
    const host = await makeHost()
    host.scriptTexts.push('第一轮回复')
    const client = makeClient(host.baseUrl)
    await client.connect()
    const { sessionId } = await client.startSession()
    await client.prompt(sessionId, '第一轮提问')

    let reconnected = false
    client.onReconnect(() => {
      reconnected = true
    })
    host.dropWebSockets()

    await waitFor(() => (reconnected ? true : undefined), 5000)
    const page = await client.fetchHistory(sessionId)
    const seqs = page.events.map((entry) => entry.event.seq)
    expect(seqs.length).toBeGreaterThanOrEqual(4)
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs) // 升序
    const last = page.events.at(-1)?.event
    expect(last?.type).toBe('assistant/message')
  })

  it('T5 下行 only 保真：WS 上发消息被 1008 关闭（协议违规姿态）', async () => {
    const host = await makeHost()
    await makeClient(host.baseUrl).connect()
    const raw = new WebSocket(`${host.baseUrl.replace('http', 'ws')}/api/events.mux`)
    await new Promise<void>((resolve) => raw.once('open', resolve))
    const closeInfo = await new Promise<{ code: number; reason: string }>((resolve) => {
      raw.once('close', (code, reason) => resolve({ code, reason: reason.toString() }))
      raw.send('violating')
    })
    expect(closeInfo.code).toBe(1008)
    expect(closeInfo.reason).toBe('downlink only')
  })

  it('P2 pluginInventory.list:形状透传 + 旧宿主(未实现)报错', async () => {
    const host = await makeHost()
    host.inventory = [
      { entryId: 'e1', moduleName: 'cordis:web-plugin', enabled: true, fiberPhase: 'active', url: '/plugins/x/client.js?rev=abc', rev: 'abc' },
      { entryId: 'e2', moduleName: 'cordis:plain', enabled: false, fiberPhase: null },
    ]
    const client = makeClient(host.baseUrl)
    const items = await client.listPlugins()
    expect(items).toEqual(host.inventory)

    host.inventory = null
    await expect(client.listPlugins()).rejects.toThrow(/no entries array|unknown mock method/)
  })
})
