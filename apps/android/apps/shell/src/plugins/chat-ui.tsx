/**
 * 插件：ui-chat
 * inject: ['dsh', 'sessions']
 *
 * 向 slot 'main' 注册对话界面组件（消息列表 + 输入栏 + 流式指示器）。
 * 注册动作包在 ctx.effect 里：插件卸载 = slot 注销 = UI 消失（注册即效果，卸载即回滚）。
 *
 * 工厂形插件：boot 时用 slot 核心实例构造（ctx.slots 属宿主装配，非注入服务）。
 */
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import type { SlotCore } from '@twibot/face-priority-slot'

import type { CordisPlugin } from '@twibot/face-cordis-kernel'
import { MAIN_BODY_KEY, MAIN_SLOT, type Message, type SessionsService } from '../types'
import { theme } from '../theme'

/** 本插件向 slot 注册的载荷。 */
export interface ChatScreenEntry {
  component: React.ComponentType
}

// ---- 气泡 ----

function Bubble({ message }: { message: Message }) {
  const isUser = message.role === 'user'
  return (
    <View style={[styles.bubbleRow, isUser ? styles.rowEnd : styles.rowStart]}>
      <View style={[styles.bubble, isUser ? styles.userBubble : styles.assistantBubble]}>
        {!isUser && message.streaming ? (
          <View style={styles.streaming}>
            <Text style={styles.streamingDot}>●</Text>
            <Text style={styles.streamingDot}>●</Text>
            <Text style={styles.streamingDot}>●</Text>
          </View>
        ) : (
          <Text
            style={[
              styles.bubbleText,
              isUser ? styles.userBubbleText : styles.assistantBubbleText,
            ]}
          >
            {message.content}
          </Text>
        )}
      </View>
    </View>
  )
}

// ---- 对话主屏（工厂闭包捕获服务实例，无全局单例）----

function createChatScreen(sessions: SessionsService) {
  return function ChatScreen() {
    const state = useSyncExternalStore(sessions.subscribe, () => sessions.state)
    const [draft, setDraft] = useState('')
    const [booting, setBooting] = useState(true)
    const [bootError, setBootError] = useState('')
    const listRef = useRef<FlatList<Message> | null>(null)

    // 挂载即建会话（幂等）；失败在界面内提示。
    useEffect(() => {
      let alive = true
      sessions
        .init()
        .catch((cause: unknown) => {
          if (!alive) return
          setBootError(cause instanceof Error ? cause.message : String(cause))
        })
        .finally(() => {
          if (alive) setBooting(false)
        })
      return () => {
        alive = false
      }
    }, [sessions])

    const autoScroll = useCallback(() => {
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }))
    }, [])

    // 新消息或流式落定时贴底。
    useLayoutEffect(() => {
      autoScroll()
    }, [state.messages.length, autoScroll])

    const onSubmit = useCallback(() => {
      const text = draft.trim()
      if (!text || state.isStreaming) return
      setDraft('')
      autoScroll()
      void sessions.send(text).catch(() => {
        // 失败已落成 ⚠️ 气泡；这里无需再弹层。
      })
    }, [draft, state.isStreaming, sessions, autoScroll])

    const renderItem = useCallback(
      ({ item }: { item: Message }) => <Bubble message={item} />,
      [],
    )

    return (
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* 顶栏职责已移交 ui-frame;列表直接到顶。 */}

        {/* 消息列表 */}
        {booting && state.messages.length === 0 ? (
          <View style={styles.center}>
            <ActivityIndicator color={theme.colors.primary} />
            <Text style={styles.hint}>正在建立会话…</Text>
          </View>
        ) : bootError ? (
          <View style={styles.center}>
            <Text style={styles.errorText}>⚠️ 会话建立失败：{bootError}</Text>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            style={styles.list}
            data={state.messages}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            ListEmptyComponent={
              <View style={styles.center}>
                <Text style={styles.hint}>发消息开始与 agent 对话</Text>
              </View>
            }
            contentContainerStyle={styles.listContent}
            onContentSizeChange={autoScroll}
          />
        )}

        {/* 底部输入栏 */}
        <View style={styles.inputBar}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="输入消息…"
            placeholderTextColor={theme.colors.textSecondary}
            editable={!state.isStreaming}
            multiline
            onSubmitEditing={onSubmit}
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!draft.trim() || state.isStreaming) && styles.sendBtnDisabled]}
            onPress={onSubmit}
            disabled={!draft.trim() || state.isStreaming}
            accessibilityLabel="发送"
          >
            <Text style={styles.sendBtnText}>➤</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    )
  }
}

// ---- 插件 ----

export function chatUIPlugin(slots: SlotCore<unknown>): CordisPlugin {
  return {
    name: 'ui-chat',
    inject: ['dsh', 'sessions'],
    apply(ctx) {
      const sessions = ctx.sessions as SessionsService
      const ChatScreen = createChatScreen(sessions)

      ctx.effect(
        () =>
          slots.register(
            MAIN_SLOT,
            { component: ChatScreen } satisfies ChatScreenEntry,
            { key: MAIN_BODY_KEY },
          ),
        'ui-chat.slot(main/body)',
      )
    },
  }
}

// ---- 样式（全部出自 theme 令牌）----

const s = theme.spacing

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: s.sm },
  hint: { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm },
  errorText: {
    color: theme.colors.error,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: s.lg,
    textAlign: 'center',
  },
  list: { flex: 1 },
  listContent: { padding: s.lg, gap: s.md },
  bubbleRow: { flexDirection: 'row' },
  rowStart: { justifyContent: 'flex-start' },
  rowEnd: { justifyContent: 'flex-end' },
  bubble: {
    maxWidth: '82%',
    borderRadius: theme.radius.lg,
    paddingHorizontal: s.md,
    paddingVertical: s.sm + 2,
  },
  userBubble: {
    backgroundColor: theme.colors.userBubbleBg,
    borderBottomRightRadius: theme.radius.sm,
  },
  assistantBubble: {
    backgroundColor: theme.colors.assistantBubbleBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    borderBottomLeftRadius: theme.radius.sm,
  },
  bubbleText: { fontSize: theme.fontSize.md, lineHeight: 22 },
  userBubbleText: { color: theme.colors.userBubbleText },
  assistantBubbleText: { color: theme.colors.assistantBubbleText },
  streaming: { flexDirection: 'row', gap: 6, paddingVertical: 2 },
  streamingDot: { color: theme.colors.streamingDot, fontSize: theme.fontSize.sm },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: s.sm,
    padding: s.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    backgroundColor: theme.colors.inputBg,
    borderColor: theme.colors.inputBorder,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    paddingHorizontal: s.md,
    paddingVertical: s.sm,
    color: theme.colors.textPrimary,
    fontSize: theme.fontSize.md,
  },
  sendBtn: {
    backgroundColor: theme.colors.userBubbleBg,
    borderRadius: theme.radius.md,
    minWidth: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },
  sendBtnText: { color: theme.colors.userBubbleText, fontSize: theme.fontSize.lg },
})
