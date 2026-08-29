/**
 * 用户主页屏（对齐 web UserProfileView）：资料卡 + 该用户推文 + 同步 + 返回。
 */
import React, { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, FlatList, Image, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import type { ApiClient, Tweet, UserProfile } from '../lib/api-client'
import { ERROR_HINTS, isOk } from '../lib/api-client'
import { initial } from '../lib/format'
import { TweetCard } from '../components/tweet-card'
import { theme } from '../theme'

export interface UserScreenProps {
  handle: string
  api: ApiClient
  onBack: () => void
  onOpenUser: (handle: string) => void
}

export function createUserScreen(props: UserScreenProps) {
  return function UserScreen() {
    const { handle, api, onBack, onOpenUser } = props
    const [user, setUser] = useState<UserProfile | null>(null)
    const [tweets, setTweets] = useState<Tweet[]>([])
    const [loaded, setLoaded] = useState(false)
    const [syncing, setSyncing] = useState(false)
    const [msg, setMsg] = useState('')

    const load = useCallback(async () => {
      const r = await api.userProfile(handle)
      if (isOk(r)) {
        setUser(r.data.user)
        setTweets(r.data.tweets)
        setMsg('')
      } else {
        setMsg(ERROR_HINTS[r.error.code] ?? r.error.message)
      }
      setLoaded(true)
    }, [api, handle])

    useEffect(() => {
      void load()
    }, [load])

    const sync = useCallback(async () => {
      setSyncing(true)
      setMsg(`正在同步 @${handle} 的推文…`)
      const r = await api.syncUserTweets(handle, 50)
      if (isOk(r)) setMsg(`同步完成：新增 ${r.data.added} 条推文`)
      else setMsg(ERROR_HINTS[r.error.code] ?? r.error.message)
      await load()
      setSyncing(false)
    }, [api, handle, load])

    const avatarUri = user?.avatarUrl ? api.imgProxyUrl(user.avatarUrl) : undefined

    return (
      <View style={styles.root}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={onBack} accessibilityLabel="返回">
            <Text style={styles.backText}>←</Text>
          </TouchableOpacity>
          <View style={styles.headerText}>
            <Text style={styles.title} numberOfLines={1}>
              {user?.name || `@${handle}`}
            </Text>
            <Text style={styles.subtitle}>
              @{handle} · {tweets.length} 条已同步
            </Text>
          </View>
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={() => void Linking.openURL(`https://x.com/${handle}`)}
            accessibilityLabel={`在 X 打开 @${handle}`}
          >
            <Text style={styles.extIcon}>⤴</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.syncBtn, syncing && styles.btnDisabled]} onPress={() => void sync()} disabled={syncing}>
            {syncing ? <ActivityIndicator color="#fff" /> : <Text style={styles.syncBtnText}>同步</Text>}
          </TouchableOpacity>
        </View>

        {/* 资料卡 */}
        <View style={styles.profile}>
          {avatarUri ? (
            <Image source={{ uri: avatarUri }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback]}>
              <Text style={styles.avatarFallbackText}>{initial(user?.name || user?.handle || handle, handle)}</Text>
            </View>
          )}
          <View style={styles.profileText}>
            <Text style={styles.profileName} numberOfLines={1}>
              {user?.name || '—'}
            </Text>
            <Text style={styles.profileHandle}>@{handle}</Text>
            {user?.bio ? <Text style={styles.profileBio}>{user.bio}</Text> : null}
          </View>
        </View>

        {msg !== '' ? <Text style={styles.msg}>{msg}</Text> : null}

        {!loaded ? (
          <View style={styles.loading}>
            <ActivityIndicator color={theme.colors.primary} />
          </View>
        ) : tweets.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>还没有 @{handle} 的推文数据</Text>
            <Text style={styles.emptyHint}>点击右上角「同步」，从该用户的 X 主页抓取最近推文。</Text>
          </View>
        ) : (
          <FlatList
            data={tweets}
            keyExtractor={(t) => t.id || `${t.text.slice(0, 24)}-${t.time}`}
            renderItem={({ item }) => (
              <TweetCard tweet={item} onOpenUser={onOpenUser} imgProxyUrl={api.imgProxyUrl} />
            )}
          />
        )}
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
    gap: s.sm,
    paddingHorizontal: s.lg,
    paddingVertical: s.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  backBtn: { padding: s.xs },
  backText: { color: theme.colors.textPrimary, fontSize: theme.fontSize.lg },
  headerText: { flex: 1, minWidth: 0 },
  title: { color: theme.colors.textPrimary, fontSize: theme.fontSize.lg, fontWeight: '800' },
  subtitle: { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm },
  iconBtn: { padding: s.xs },
  extIcon: { color: theme.colors.textSecondary, fontSize: theme.fontSize.lg },
  syncBtn: {
    backgroundColor: theme.colors.userBubbleBg,
    borderRadius: 999,
    paddingHorizontal: s.lg,
    paddingVertical: s.sm,
  },
  btnDisabled: { opacity: 0.5 },
  syncBtnText: { color: '#fff', fontWeight: '700', fontSize: theme.fontSize.sm },
  profile: {
    flexDirection: 'row',
    gap: s.lg,
    padding: s.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: theme.colors.surface },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarFallbackText: { color: theme.colors.textSecondary, fontSize: theme.fontSize.lg, fontWeight: '700' },
  profileText: { flex: 1, minWidth: 0 },
  profileName: { color: theme.colors.textPrimary, fontSize: theme.fontSize.lg, fontWeight: '700' },
  profileHandle: { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm },
  profileBio: { color: theme.colors.textPrimary, fontSize: theme.fontSize.sm, marginTop: s.xs, opacity: 0.8 },
  msg: {
    color: theme.colors.textSecondary,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: s.lg,
    paddingVertical: s.sm,
    backgroundColor: theme.colors.surface,
  },
  loading: { padding: s.xl * 2, alignItems: 'center' },
  empty: { alignItems: 'center', gap: s.sm, padding: s.xl * 2 },
  emptyTitle: { color: theme.colors.textSecondary, fontSize: theme.fontSize.md },
  emptyHint: { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm, textAlign: 'center' },
})