/**
 * 插件：session-store
 * inject: ['dsh'] / provide: 'sessions'
 *
 * 管理当前会话的客户端投影：sessionId、消息列表、流式标记、连接态。
 * 状态放 zustand vanilla store——RN 组件可订阅，插件本体保持平台无关。
 *
 * 口径与 mvp-report 一致：服务端是真相源，本地只是投影。
 * - send：乐观上屏用户消息 + 流式占位气泡，prompt 收敛后原位落定最终文本。
 * - reload：整页重拉历史重建基线（协议无增量；onReconnect / 回前台都走这里）。
 */
import { createStore } from 'zustand/vanilla'
import {
  textOfContent,
  type HistoryPage,
  type SessionEvent,
} from '@twibot/face-protocol-client/protocol'

import type { CordisPlugin } from '@twibot/face-cordis-kernel'
import type { DshService, Message, SessionState, SessionsService } from '../types'

// ---- 本地 id 铸造（列表 key 用，与服务端 id 解耦）----

let localSeq = 0

function nextLocalId(prefix: string): string {
  localSeq += 1
  return `${prefix}-${localSeq.toString(36)}-${Date.now().toString(36)}`
}

// ---- 服务端事件 → 客户端投影（history 重建基线用）----

/** 从单条会话事件提取可见消息；非消息事件或空文本返回 null。 */
export function messageFromSessionEvent(event: SessionEvent): Message | null {
  const data = (event.data ?? {}) as {
    content?: Parameters<typeof textOfContent>[0]
    message?: { content?: Parameters<typeof textOfContent>[0]; role?: string }
  }
  if (event.type !== 'user/message' && event.type !== 'assistant/message') return null
  // wire 形态差异：user/message 的 content 平铺在 data 上，assistant/message 包一层 message。
  const content = textOfContent(event.type === 'user/message' ? (data.content ?? data.message?.content) : data.message?.content)
  if (!content.trim()) return null
  return {
    id: `h-${event.seq}`,
    role: event.type === 'user/message' ? 'user' : 'assistant',
    content,
    timestamp: typeof event.time === 'number' ? event.time : Date.now(),
  }
}

/** 历史分页 → 消息列表（顺序即 wire 顺序）。 */
export function messagesFromHistory(page: HistoryPage): Message[] {
  const messages: Message[] = []
  for (const entry of page.events) {
    const message = messageFromSessionEvent(entry.event)
    if (message) messages.push(message)
  }
  return messages
}

// ---- 插件 ----

export const sessionPlugin: CordisPlugin = {
  name: 'session-store',
  inject: ['dsh'],
  apply(ctx) {
    const dsh = ctx.dsh as DshService

    const store = createStore<SessionState>()(() => ({
      sessionId: null,
      messages: [],
      isStreaming: false,
      connected: false,
    }))

    // ---- 连接态投影 + 断线自动整页重拉（效果随 fiber 卸载解除）----
    const offState = dsh.onStateChange((state) => {
      store.setState({ connected: state === 'connected' })
    })
    const offReconnect = dsh.onReconnect(() => {
      void service.reload().catch(() => {
        // 重拉失败不拖垮连接机：下次重连再试。
      })
    })
    ctx.effect(
      () => () => {
        offState()
        offReconnect()
      },
      'session-store.detach',
    )

    // ---- 会话生命周期 ----

    let initPromise: Promise<void> | null = null

    /**
     * 里程碑 E：杀进程重开 → 历史恢复。
     * 服务端是真相源：不本地持久化 sessionId，重启后经 session.list
     * 接管最近一个非空会话（updatedAt 降序首个 blank=false），整页重拉基线。
     * 宿主无该方法或列表失败时回退为新建会话。
     */
    async function adoptLatestSession(): Promise<string | null> {
      try {
        const items = await dsh.listSessions()
        const candidate = items.find((item) => !item.blank)
        return candidate?.sessionId ?? null
      } catch {
        return null
      }
    }

    async function ensureSession(): Promise<string> {
      const existing = store.getState().sessionId
      if (existing) return existing
      if (!initPromise) {
        initPromise = (async () => {
          await dsh.connect()
          const adopted = await adoptLatestSession()
          if (adopted) {
            store.setState({ sessionId: adopted })
            await service.reload()
            return
          }
          const { sessionId } = await dsh.startSession()
          store.setState({ sessionId })
        })()
      }
      try {
        await initPromise
      } finally {
        initPromise = null
      }
      return store.getState().sessionId as string
    }

    // ---- 消息操作（全部经 store.setState 保持单一写入路径）----

    function appendMessage(message: Message): void {
      store.setState((prev) => ({ messages: [...prev.messages, message] }))
    }

    /** 落定流式占位气泡；占位已丢失（如被 reload 替换）则追加。 */
    function settlePlaceholder(id: string, content: string): void {
      store.setState((prev) => {
        const index = prev.messages.findIndex((m) => m.id === id)
        if (index === -1) {
          return {
            messages: [
              ...prev.messages,
              { id, role: 'assistant', content, timestamp: Date.now() },
            ],
          }
        }
        const messages = prev.messages.slice()
        messages[index] = { ...messages[index], content, streaming: false }
        return { messages }
      })
    }

    // ---- 对外服务 ----

    const service: SessionsService = {
      get state() {
        return store.getState()
      },
      subscribe: store.subscribe,

      async init() {
        await ensureSession()
      },

      async send(text) {
        const trimmed = text.trim()
        if (!trimmed) throw new Error('send(): empty text')
        const sessionId = await ensureSession()

        // 乐观上屏：用户气泡 + 助手流式占位
        const placeholderId = nextLocalId('a')
        appendMessage({
          id: nextLocalId('u'),
          role: 'user',
          content: trimmed,
          timestamp: Date.now(),
        })
        appendMessage({
          id: placeholderId,
          role: 'assistant',
          content: '',
          timestamp: Date.now(),
          streaming: true,
        })
        store.setState({ isStreaming: true })

        try {
          const result = await dsh.prompt(sessionId, trimmed)
          settlePlaceholder(placeholderId, result.text)
          return result.text
        } catch (cause) {
          const detail = cause instanceof Error ? cause.message : String(cause)
          settlePlaceholder(placeholderId, `⚠️ 发送失败：${detail}`)
          throw cause
        } finally {
          store.setState({ isStreaming: false })
        }
      },

      async reload() {
        const sessionId = store.getState().sessionId
        if (!sessionId) return 0
        if (dsh.connectionState !== 'connected') await dsh.connect()
        // MVP 只取尾页（协议向旧翻页，尾页附 projections 基线）；翻页加载属 P1。
        const page = await dsh.fetchHistory(sessionId, { maxMessages: 200 })
        const messages = messagesFromHistory(page)
        store.setState({ messages })
        return messages.length
      },

      async switchTo(sessionId) {
        const current = store.getState().sessionId
        if (current === sessionId) return
        if (dsh.connectionState !== 'connected') await dsh.connect()
        // 先清投影再重拉:切换瞬间不泄漏上一会话的消息。
        store.setState({ sessionId, messages: [], isStreaming: false })
        await service.reload()
      },

      async newSession() {
        if (dsh.connectionState !== 'connected') await dsh.connect()
        const { sessionId } = await dsh.startSession()
        store.setState({ sessionId, messages: [], isStreaming: false })
        return sessionId
      },
    }

    ctx.provide('sessions', service)
  },
}
