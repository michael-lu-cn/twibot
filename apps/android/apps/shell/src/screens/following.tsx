/**
 * 关注列表屏（对齐 web FollowingView）：列表 + 同步 + 批量同步推文进度。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Image,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import type { ApiClient, BatchTask, FollowingUser } from '../lib/api-client'
import { ERROR_HINTS, isOk } from '../lib/api-client'
import { initial } from '../lib/format'
import { spacing as s, type Theme } from '../theme'
import { useTheme } from '../theme-context'

export interface FollowingScreenProps {
  api: ApiClient
  onOpenUser: (handle: string) => void
}

export function createFollowingScreen(props: FollowingScreenProps) {
  return function FollowingScreen() {
    const { api, onOpenUser } = props
    const { theme } = useTheme()
    const styles = useMemo(() => makeStyles(theme), [theme])
    const [users, setUsers] = useState<FollowingUser[]>([])
    const [handle, setHandle] = useState<string | null>(null)
    const [loaded, setLoaded] = useState(false)
    const [syncing, setSyncing] = useState(false)
    const [batch, setBatch] = useState<BatchTask | null>(null)
    const [msg, setMsg] = useState('')

    const load = useCallback(async () => {
      const r = await api.following(200)
      if (isOk(r)) {
        setUsers(r.data.users)
        setHandle(r.data.handle)
        setMsg('')
      } else if (r.error.code !== 'NOT_SYNCED' && r.error.code !== 'NO_ME') {
        setMsg(ERROR_HINTS[r.error.code] ?? r.error.message)
      }
      setLoaded(true)
    }, [api])

    useEffect(() => {
      void load()
    }, [load])

    const sync = useCallback(async () => {
      setSyncing(true)
      setMsg('正在同步关注列表…')
      const r = await api.syncFollowing(200)
      if (isOk(r)) {
        setHandle(r.data.handle)
        setMsg(`同步完成：新增 ${r.data.added} 位关注`)
      } else {
        setMsg(ERROR_HINTS[r.error.code] ?? r.error.message)
      }
      await load()
      setSyncing(false)
    }, [api, load])

    const batchRunning = batch?.status === 'running'

    const startBatch = useCallback(async () => {
      if (batchRunning) return
      setMsg('正在启动批量同步（每个关注用户 10 条推文）…')
      const r = await api.startBatchUserTweets(10)
      if (!isOk(r)) {
        setMsg(ERROR_HINTS[r.error.code] ?? r.error.message)
        return
      }
      const t = await api.batchTask(r.data.taskId)
      if (isOk(t)) setBatch(t.data)
      else setBatch({ id: r.data.taskId, status: 'running', total: 0, done: 0, added: 0, createdAt: Date.now() })
    }, [api, batchRunning])

    // 批量任务运行期间轮询进度（页面挂载时）
    useEffect(() => {
      if (!batch?.id || !batchRunning) return
      const timer = setInterval(async () => {
        const r = await api.batchTask(batch.id)
        if (isOk(r)) setBatch(r.data)
      }, 4000)
      return () => clearInterval(timer)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [batch?.id, batchRunning])

    const header = (
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>关注</Text>
          <Text style={styles.subtitle}>{handle ? `@${handle} 关注的账号` : '我关注的账号'}</Text>
        </View>
        <TouchableOpacity style={[styles.syncBtn, syncing && styles.btnDisabled]} onPress={() => void sync()} disabled={syncing}>
          {syncing ? <ActivityIndicator color="#fff" /> : <Text style={styles.syncBtnText}>同步</Text>}
        </TouchableOpacity>
        <TouchableOpacity style={[styles.batchBtn, batchRunning && styles.btnDisabled]} onPress={() => void startBatch()} disabled={batchRunning}>
          <Text style={styles.batchBtnText}>{batchRunning ? '批量中…' : '批量'}</Text>
        </TouchableOpacity>
      </View>
    )

    return (
      <View style={styles.root}>
        {header}
        {batch ? (
          <View style={styles.batchBar}>
            <Text style={styles.batchText}>
              {batchRunning
                ? `批量同步中：@{batch.current ?? '…' ?? ''} · ${batch.done}/${batch.total} · 已新增 ${batch.added}`
                : batch.status === 'done'
                  ? `批量同步完成：${batch.done} 位用户，新增 ${batch.added} 条推文`
                  : `批量同步失败：${batch.error ?? batch.status}`}
            </Text>
            {batchRunning ? (
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    { width: `${batch.total ? Math.round((batch.done / batch.total) * 100) : 4}%` },
                  ]}
                />
              </View>
            ) : null}
          </View>
        ) : null}
        {msg !== '' ? <Text style={styles.msg}>{msg}</Text> : null}

        {!loaded ? (
          <View style={styles.loading}>
            <ActivityIndicator color={theme.colors.primary} />
          </View>
        ) : users.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>还没有关注列表数据</Text>
            <Text style={styles.emptyHint}>点击右上角「同步」，从你的 X 账号抓取关注列表。</Text>
          </View>
        ) : (
          <FlatList
            data={users}
            keyExtractor={(u) => u.userId ?? u.handle}
            renderItem={({ item: u }) => (
              <TouchableOpacity style={styles.row} onPress={() => onOpenUser(u.handle)} activeOpacity={0.7}>
                {u.avatarUrl ? (
                  <Image source={{ uri: api.imgProxyUrl(u.avatarUrl) }} style={styles.avatar} />
                ) : (
                  <View style={[styles.avatar, styles.avatarFallback]}>
                    <Text style={styles.avatarFallbackText}>{initial(u.name, u.handle)}</Text>
                  </View>
                )}
                <View style={styles.rowText}>
                  <View style={styles.rowNames}>
                    <Text style={styles.rowName} numberOfLines={1}>
                      {u.name}
                    </Text>
                    <Text style={styles.rowHandle} numberOfLines={1}>
                      @{u.handle}
                    </Text>
                  </View>
                  {u.bio ? (
                    <Text style={styles.rowBio} numberOfLines={2}>
                      {u.bio}
                    </Text>
                  ) : null}
                </View>
                <TouchableOpacity
                  style={styles.extBtn}
                  onPress={() => void Linking.openURL(`https://x.com/${u.handle}`)}
                  accessibilityLabel={`在 X 打开 @${u.handle}`}
                >
                  <Text style={styles.extIcon}>⤴</Text>
                </TouchableOpacity>
              </TouchableOpacity>
            )}
          />
        )}
      </View>
    )
  }
}

const makeStyles = (theme: Theme) => StyleSheet.create({
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
  headerText: { flex: 1, minWidth: 0 },
  title: { color: theme.colors.textPrimary, fontSize: theme.fontSize.lg, fontWeight: '800' },
  subtitle: { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm },
  syncBtn: {
    backgroundColor: theme.colors.userBubbleBg,
    borderRadius: 999,
    paddingHorizontal: s.lg,
    paddingVertical: s.sm,
  },
  batchBtn: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: s.lg,
    paddingVertical: s.sm,
  },
  btnDisabled: { opacity: 0.5 },
  syncBtnText: { color: '#fff', fontWeight: '700', fontSize: theme.fontSize.sm },
  batchBtnText: { color: theme.colors.textSecondary, fontWeight: '700', fontSize: theme.fontSize.sm },
  batchBar: { paddingHorizontal: s.lg, paddingVertical: s.sm, backgroundColor: theme.colors.surface, gap: s.xs },
  batchText: { color: theme.colors.textSecondary, fontSize: theme.fontSize.xs },
  progressTrack: { height: 4, borderRadius: 2, backgroundColor: theme.colors.border, overflow: 'hidden' },
  progressFill: { height: 4, borderRadius: 2, backgroundColor: '#38bdf8' },
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s.md,
    paddingHorizontal: s.lg,
    paddingVertical: s.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: theme.colors.surface },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarFallbackText: { color: theme.colors.textSecondary, fontSize: theme.fontSize.lg, fontWeight: '700' },
  rowText: { flex: 1, minWidth: 0 },
  rowNames: { flexDirection: 'row', alignItems: 'baseline', gap: s.xs },
  rowName: { color: theme.colors.textPrimary, fontWeight: '700', fontSize: theme.fontSize.md, flexShrink: 1 },
  rowHandle: { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm, flexShrink: 1 },
  rowBio: { color: theme.colors.textPrimary, fontSize: theme.fontSize.sm, opacity: 0.8, marginTop: 2 },
  extBtn: { padding: s.xs },
  extIcon: { color: theme.colors.textSecondary, fontSize: theme.fontSize.md },
})