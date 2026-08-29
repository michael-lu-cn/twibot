/**
 * 推荐流屏（对齐 web FeedView）：FlatList + TweetCard + 同步。
 */
import React, { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import type { ApiClient, Tweet } from '../lib/api-client'
import { ERROR_HINTS, isOk } from '../lib/api-client'
import { TweetCard } from '../components/tweet-card'
import { theme } from '../theme'

export interface FeedScreenProps {
  api: ApiClient
  onOpenUser: (handle: string) => void
}

export function createFeedScreen(props: FeedScreenProps) {
  return function FeedScreen() {
    const { api, onOpenUser } = props
    const [tweets, setTweets] = useState<Tweet[]>([])
    const [loaded, setLoaded] = useState(false)
    const [syncing, setSyncing] = useState(false)
    const [msg, setMsg] = useState('')

    const load = useCallback(async () => {
      const r = await api.feed(50)
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
      setMsg('正在同步推荐流…')
      const r = await api.syncFeed(50)
      if (isOk(r)) {
        setMsg(`同步完成：新增 ${r.data.added} 条`)
      } else {
        setMsg(ERROR_HINTS[r.error.code] ?? r.error.message)
      }
      await load()
      setSyncing(false)
    }, [api, load])

    const header = (
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>主页</Text>
          <Text style={styles.subtitle}>推荐流{loaded && tweets.length > 0 ? ` · ${tweets.length} 条` : ''}</Text>
        </View>
        <TouchableOpacity style={[styles.syncBtn, syncing && styles.btnDisabled]} onPress={() => void sync()} disabled={syncing}>
          {syncing ? <ActivityIndicator color="#fff" /> : <Text style={styles.syncBtnText}>同步</Text>}
        </TouchableOpacity>
      </View>
    )

    if (!loaded) {
      return (
        <View style={styles.root}>
          {header}
          {Array.from({ length: 5 }).map((_, i) => (
            <View key={i} style={styles.skeletonRow}>
              <View style={styles.skeletonAvatar} />
              <View style={styles.skeletonLines}>
                <View style={styles.skeletonLineShort} />
                <View style={styles.skeletonLine} />
              </View>
            </View>
          ))}
        </View>
      )
    }

    if (tweets.length === 0) {
      return (
        <View style={styles.root}>
          {header}
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>还没有推荐流数据</Text>
            <Text style={styles.emptyHint}>点击右上角「同步」，从你的 X 账号抓取推荐流。</Text>
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
        <FlatList
          data={tweets}
          keyExtractor={(t) => t.id || `${t.text.slice(0, 24)}-${t.time}`}
          renderItem={({ item }) => (
            <TweetCard tweet={item} onOpenUser={onOpenUser} imgProxyUrl={api.imgProxyUrl} />
          )}
        />
      </View>
    )
  }
}

const s = theme.spacing
const styles = StyleSheet.create({
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
  syncBtn: {
    backgroundColor: theme.colors.userBubbleBg,
    borderRadius: 999,
    paddingHorizontal: s.lg,
    paddingVertical: s.sm,
  },
  btnDisabled: { opacity: 0.5 },
  syncBtnText: { color: '#fff', fontWeight: '700', fontSize: theme.fontSize.sm },
  msg: {
    color: theme.colors.textSecondary,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: s.lg,
    paddingVertical: s.sm,
    backgroundColor: theme.colors.surface,
  },
  empty: { alignItems: 'center', gap: s.sm, padding: s.xl * 2 },
  emptyTitle: { color: theme.colors.textSecondary, fontSize: theme.fontSize.md },
  emptyHint: { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm, textAlign: 'center' },
  skeletonRow: { flexDirection: 'row', gap: s.md, padding: s.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border },
  skeletonAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: theme.colors.surface },
  skeletonLines: { flex: 1, gap: s.sm, paddingTop: 4 },
  skeletonLine: { height: 12, borderRadius: 6, backgroundColor: theme.colors.surface },
  skeletonLineShort: { height: 12, width: '55%', borderRadius: 6, backgroundColor: theme.colors.surface },
})