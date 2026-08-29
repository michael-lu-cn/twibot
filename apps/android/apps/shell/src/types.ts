/**
 * P0.5 共享类型：消息模型、会话状态、插件间服务契约。
 *
 * 一切皆插件：跨插件流动的只有这里的类型与 ctx 上注入的服务。
 * Message 是客户端投影（服务端事件流才是真相源，见 mvp-report 范式转移）。
 */

/** 客户端可见的一条聊天消息（纯文本 MVP，不渲染 markdown）。 */
/** 对话界面所在的唯一主槽位 id(壳与 ui-chat 插件共用)。 */
export const MAIN_SLOT = 'main'

/**
 * S0 契约(并行插件开发用):
 * 主槽位的 keyed cell 'body' = 主内容区(chat-ui 注册于此,时钟面板等可遮蔽);
 * 抽屉槽位 'drawer' 的 keyed cell 'left'/'right' = 左右侧栏内容
 * (drawer-sessions / drawer-settings 注册于此;ui-frame 按 key 渲染胜出者)。
 * 各插件只认这组契约,互不感知实现。
 */
export const MAIN_BODY_KEY = 'body'
export const DRAWER_SLOT = 'drawer'
export const DRAWER_LEFT = 'left'
export const DRAWER_RIGHT = 'right'

export interface Message {
  /** 本地铸造的稳定 id（列表 key 用；wire 上的 id 不透明且常缺省）。 */
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  /** 正在流式输出中（占位气泡）。 */
  streaming?: boolean
}

/** session-store 插件持有的全部状态。 */
export interface SessionState {
  sessionId: string | null
  messages: Message[]
  isStreaming: boolean
  connected: boolean
}

/**
 * dsh-connection 插件 provide 的服务。
 * 直接复用 DshClient 类型——连接层不做二次抽象。
 */
import type { DshClient } from '@twibot/face-protocol-client'

export type DshService = DshClient

/** session-store 插件 provide 的服务。 */
export interface SessionsService {
  /** 当前状态快照（同步读）。 */
  readonly state: SessionState
  /** 订阅状态变化（zustand vanilla 语义）；返回退订函数。 */
  subscribe(listener: (state: SessionState, prevState: SessionState) => void): () => void
  /** 建会话 + 连接双流；幂等。 */
  init(): Promise<void>
  /** 发送一轮对话；返回最终 assistant 文本。 */
  send(text: string): Promise<string>
  /**
   * 切换到指定会话:设当前 sessionId → 整页重拉其历史重建基线。
   * 服务端是真相源,本地只换投影(与 reload 同一口径)。
   */
  switchTo(sessionId: string): Promise<void>
  /** 新建会话并切换过去;返回新 sessionId(投影清空,等待首轮对话)。 */
  newSession(): Promise<string>
  /**
   * 整页重拉会话历史重建基线（断线重连 / 回前台恢复）。
   * 返回恢复的消息条数；无会话时返回 0。
   */
  reload(): Promise<number>
}
