/**
 * 书签屏（对齐 web BookmarksView）：全量加载 + 按月分组 SectionList + 月份 chips 导航。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, ScrollView, SectionList, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import type { ApiClient, Tweet } from '../lib/api-client'
import { ERROR_HINTS, isOk } from '../lib/api-client'
import { groupByMonth } from '../lib/group'
import { TweetCard } from '../components/tweet-card'
import { spacing as s, type Theme } from '../theme'
import { useTheme } from '../theme-context'

export interface BookmarksScreenProps {
  api: ApiClient
  onOpenUser: (handle: string) => void
}

export function createBookmarksScreen(props: BookmarksScreenProps) {
  return function BookmarksScreen() {
    const { api, onOpenUser } = props
    const { theme } = useTheme()
    const styles = useMemo(() => makeStyles(theme), [theme])
    const [tweets, setTweets] = useState<Tweet[]>([])
    const [loaded, setLoaded] = useState(false)
    const [syncing, setSyncing] = useState(false)
    const [msg, setMsg] = useState('')
    const listRef = useRef<SectionList<Tweet>>(null)

    const groups = useMemo(() => groupByMonth(tweets), [tweets])
    const sections = useMemo(
      () => groups.map((g) => ({ key: g.key, title: g.label, data: g.tweets })),
      [groups],
    )

    const load = useCallback(async () => {
      const r = await api.bookmarks()
      if (isOk(r)) {
        setTweets(r.data.tweets)
        setMsg('')
      } else if (r.error.code !== 'NOT_SYNCED') {
        setMsg(ERROR_HINTS[r.error.code] ?? r.error.message)
      }
      setLoaded(true)
    }, [api])

    useEffect(() => {
      void load()
    }, [load])

    const sync = useCallback(async () => {
      setSyncing(true)
      setMsg('正在同步书签…')
      const r = await api.syncBookmarks()
      if (isOk(r)) setMsg(`同步完成：新增 ${r.data.added} 条`)
      else setMsg(ERROR_HINTS[r.error.code] ?? r.error.message)
      await load()
      setSyncing(false)
    }, [api, load])

    const header = (
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>书签</Text>
          <Text style={styles.subtitle}>收藏的推文{loaded && tweets.length > 0 ? ` · ${tweets.length} 条` : ''}</Text>
        </View>
        <TouchableOpacity style={[styles.syncBtn, syncing && styles.btnDisabled]} onPress={() => void sync()} disabled={syncing}>
          {syncing ? <ActivityIndicator color="#fff" /> : <Text style={styles.syncBtnText}>同步</Text>}
        </TouchableOpacity>
      </View>
    )

    // 月份导航 chips：点击滚动到对应分组
    const chips =
      groups.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips} contentContainerStyle={styles.chipsContent}>
          {groups.map((g, i) => (
            <TouchableOpacity
              key={g.key}
              style={styles.chip}
              onPress={() => {
                try {
                  listRef.current?.scrollToLocation({ sectionIndex: i, itemIndex: 0, viewPosition: 0 })
                } catch {
                  // 未渲染 section 由 onScrollToIndexFailed 兜底，此处仅防抛错
                }
              }}
            >
              <Text style={styles.chipText}>{g.label}</Text>
              <Text style={styles.chipCount}>{g.tweets.length}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      ) : null

    if (!loaded) {
      return (
        <View style={styles.root}>
          {header}
          <View style={styles.loading}>
            <ActivityIndicator color={theme.colors.primary} />
          </View>
        </View>
      )
    }

    if (tweets.length === 0) {
      return (
        <View style={styles.root}>
          {header}
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>还没有书签数据</Text>
            <Text style={styles.emptyHint}>点击右上角「同步」，从你的 X 账号抓取收藏的推文。</Text>
            <TouchableOpacity style={styles.syncBtn} onPress={() => void sync()} disabled={syncing}>
              <Text style={styles.syncBtnText}>首次同步</Text>
            </TouchableOpacity>
          </View>
        </View>
      )
    }

    return (
      <View style={styles.root}>
        {header}
        {msg !== '' ? <Text style={styles.msg}>{msg}</Text> : null}
        {chips}
        <SectionList
          ref={listRef}
          sections={sections}
          keyExtractor={(t) => t.id || `${t.text.slice(0, 24)}-${t.time}`}
          stickySectionHeadersEnabled
          onScrollToIndexFailed={(info) => {
            // 无 getItemLayout 时 scrollToLocation 的降级路径（RN 官方建议）：
            // 用 ScrollView.scrollTo 按平均行高估算偏移。
            ;(listRef.current as unknown as { scrollTo: (p: { y: number; animated?: boolean }) => void })?.scrollTo({
              y: info.averageItemLength * info.index,
              animated: true,
            })
          }}
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
              <Text style={styles.sectionCount}>{section.data.length} 条</Text>
            </View>
          )}
          renderItem={({ item }) => <TweetCard tweet={item} onOpenUser={onOpenUser} imgProxyUrl={api.imgProxyUrl} />}
        />
      </View>
    )
  }
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: s.lg,
    paddingVertical: s.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  headerText: { flex: 1 },
  title: { color: theme.colors.textPrimary, fontSize: theme.fontSize.lg, fontWeight: '800' },
  subtitle: { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm },
  syncBtn: { backgroundColor: theme.colors.userBubbleBg, borderRadius: 999, paddingHorizontal: s.lg, paddingVertical: s.sm },
  btnDisabled: { opacity: 0.5 },
  syncBtnText: { color: '#fff', fontWeight: '700', fontSize: theme.fontSize.sm },
  msg: { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm, paddingHorizontal: s.lg, paddingVertical: s.sm, backgroundColor: theme.colors.surface },
  chips: { flexGrow: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border },
  chipsContent: { padding: s.md, gap: s.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: s.md,
    paddingVertical: s.sm,
    marginRight: s.sm,
  },
  chipText: { color: theme.colors.textPrimary, fontSize: theme.fontSize.sm },
  chipCount: { color: theme.colors.textSecondary, fontSize: theme.fontSize.xs },
  loading: { padding: s.xl * 2, alignItems: 'center' },
  empty: { alignItems: 'center', gap: s.sm, padding: s.xl * 2 },
  emptyTitle: { color: theme.colors.textSecondary, fontSize: theme.fontSize.md },
  emptyHint: { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm, textAlign: 'center' },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: s.sm,
    backgroundColor: theme.colors.background,
    paddingHorizontal: s.lg,
    paddingVertical: s.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  sectionTitle: { color: theme.colors.textPrimary, fontSize: theme.fontSize.sm, fontWeight: '800' },
  sectionCount: { color: theme.colors.textSecondary, fontSize: theme.fontSize.xs },
})