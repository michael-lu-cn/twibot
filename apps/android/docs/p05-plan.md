# P0.5 最简对话客户端 —— 基于 Cordis 模式的开发计划

> 目标：模仿 dsh web 端 UI 风格，实现基本对话功能。
> 架构原则：一切皆插件，注册即效果，卸载即回滚。
> 这不是原型——这是正式代码的第一层，后续所有功能在此之上生长。

## 与 P0 的区别

P0 验证了管线可行性（实验面板，手动调用函数）。
P0.5 开始用 **真正的 Cordis 模式**组织代码：每个功能 = 一个插件，通过 ctx 消费服务，通过 slot 注册 UI。

## 插件树

```
Context (root)
├── plugin: dsh-connection
│   inject: []
│   provide: 'dsh'
│   职责：创建 DshClient、管理连接状态
│   效果：卸载时 close()
│
├── plugin: session-store
│   inject: ['dsh']
│   provide: 'sessions'
│   职责：管理当前会话状态（ID、消息列表、流式状态）
│   数据结构：
│     { sessionId, messages: Message[], isStreaming }
│   效果：卸载时断开事件监听
│
└── plugin: ui-chat
    inject: ['dsh', 'sessions']
    职责：向 slot 'main' 注册对话界面组件
    组件包含：
      - 消息列表（FlatList）
      - 输入栏（TextInput + 发送按钮）
      - 流式指示器
    效果：卸载时 slot 注销 → UI 消失
```

## 文件结构

```
apps/shell/src/
├── theme.ts                 # dsh 令牌 → RN StyleSheet 常量
├── plugins/
│   ├── connection.ts        # dsh-connection 插件
│   ├── sessions.ts          # session-store 插件
│   └── chat-ui.tsx          # ui-chat 插件
├── types.ts                 # 共享类型（Message 等）
└── index.ts                 # 组装入口：创建 Context → 加载插件列表
```

## 核心类型

```typescript
// types.ts
interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string           // 纯文本（MVP 不渲染 markdown）
  timestamp: number
  streaming?: boolean       // 正在流式输出中
}

interface SessionState {
  sessionId: string | null
  messages: Message[]
  isStreaming: boolean
  connected: boolean
}
```

## 各插件契约

### dsh-connection

```typescript
export const connectionPlugin = {
  name: 'dsh-connection',
  apply(ctx: Context) {
    const client = new DshClient({
      baseUrl: ctx.config.baseUrl,
      timeouts: { streamOpenMs: 15000, unaryMs: 25000 },
    })
    ctx.provide('dsh', client)
    ctx.effect(() => () => client.close())
  },
}
```

### session-store

```typescript
export const sessionPlugin = {
  name: 'session-store',
  inject: ['dsh'],
  apply(ctx: Context) {
    const state: SessionState = {
      sessionId: null,
      messages: [],
      isStreaming: false,
      connected: false,
    }

    // 用 zustand vanilla store 让 RN 组件能订阅变化
    const store = createStore<SessionState>(() => state)

    ctx.provide('sessions', {
      get state() { return store.getState() },
      subscribe: store.subscribe,

      async init() {
        const sid = await ctx.dsh.startSession()
        store.setState({ sessionId: sid })
      },

      async send(text: string) {
        // 乐观添加用户消息
        addUserMessage(store, text)
        setStreaming(store, true)

        // 发送 prompt 并收集回复
        const result = await ctx.dsh.prompt(state.sessionId!, text)

        // 用完整回复替换流式占位
        addAssistantMessage(store, result.text)
        setStreaming(store, false)
      },
    })
  },
}
```

MVP 阶段先不做逐 chunk 流式渲染——prompt 完成后一次性显示。
后续升级为逐 delta 渲染。

### ui-chat

```typescript
export const chatUIPlugin = {
  name: 'ui-chat',
  inject: ['dsh', 'sessions'],
  apply(ctx: Context) {
    ctx.slots.register('main', ChatScreen)
    ctx.effect(() => () => console.log('ui-chat unmounted'))
  },
}
```

ChatScreen 是一个 React Native 函数组件：

```
┌─────────────────────────────┐
│ ← Cordis Face               │  ← 头部栏
├─────────────────────────────┤
│                             │
│  ┌─ 用户 ─────────────┐    │
│  │ 你好                │    │  ← 用户消息（右侧对齐）
│  └────────────────────┘    │
│                             │
│  ┌─ 助手 ─────────────┐    │
│  │ 你好！我是...       │    │  ← 助手消息（左侧对齐）
│  └────────────────────┘    │
│                             │
│  ● ● ●                     │  ← 流式指示器
│                             │
├─────────────────────────────┤
│ [输入框............] [➤]   │  ← 底部输入栏
└─────────────────────────────┘
```

## 主题令牌

从 dsh web 端 `--dsw-*` 体系提取核心色值：

```typescript
// theme.ts
export const theme = {
  colors: {
    background: '#101014',
    surface: '#17171d',
    border: '#2b2b3a',
    primary: '#9aa0ff',
    textPrimary: '#e5e7eb',
    textSecondary: '#9ca3af',
    userBubbleBg: '#2b2bd6',
    userBubbleText: '#ffffff',
    assistantBubbleBg: '#1e1e28',
    assistantBubbleText: '#cfd3ff',
    inputBg: '#0d0d11',
    inputBorder: '#2b2b3a',
    success: '#4ade80',
    error: '#f87171',
    streamingDot: '#9aa0ff',
  },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
  radius: { sm: 8, md: 12, lg: 16 },
  fontSize: { xs: 11, sm: 13, md: 15, lg: 17 },
} as const

export type Theme = typeof theme
```

## 组装入口

```typescript
// index.ts
import { Context } from '@face/cordis-kernel'
import { connectionPlugin } from './plugins/connection'
import { sessionPlugin } from './plugins/sessions'
import { chatUIPlugin } from './plugins/chat-ui'

export function boot(baseUrl: string) {
  const ctx = new Context() as any
  ctx.config = { baseUrl }

  // 按 inject 依赖顺序加载（cordis 自动处理，这里显式写出便于理解）
  ctx.plugin(connectionPlugin)   // provide: dsh
  ctx.plugin(sessionPlugin)      // inject: dsh → provide: sessions
  ctx.plugin(chatUIPlugin)       // inject: dsh, sessions → 注册 UI

  return ctx
}
```

App.tsx 只需调 `boot()` 并渲染 slot 内容。

## 里程碑

| 阶段 | 内容 | 验证标准 | 预估 |
|---|---|---|---|
| A 服务层 | connection + session-store 两个插件跑通 | ctx.sessions.send('hello') 返回非空文本 | 2h |
| B UI 渲染 | ChatScreen 组件 + slot 注册 | 模拟器上看到消息列表和输入框 | 2h |
| C 对话闭环 | 输入→发送→流式等待→显示回复 | 发送"你好"收到非空回复上屏 | 2h |
| D 样式打磨 | dsh 主题令牌应用、暗色配色 | 视觉与 web 端一致 | 1h |
| E 恢复测试 | 杀进程重开 → resume → 历史消息恢复 | 重开后消息不丢失 | 1h |

总计约 **8 小时**。

## 明确不做

- Markdown / 代码高亮渲染（纯文本 MVP）
- 多会话切换（单会话）
- 图片/文件发送
- 工具调用结果展示
- 推送通知
- 动态 chunk 加载（P2）
- JSC 引擎（当前 Hermes 足够）
- 离线缓存（服务端是真相源）

## 与 P1 的衔接

P0.5 完成后，P1 在此基础上：
1. 把静态插件列表改为 roster 配置驱动
2. 引入模块表（lazy factory）支持动态加载
3. 添加更多插件（设置页、会话列表等）
4. 验证标准：删一行配置对应 UI 消失
