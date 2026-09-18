/**
 * 智能分组屏（对齐 web GroupsView）：组 chips 导航 + 成员列表 + 操作。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import type { ApiClient, GroupOption, SmartGroup, SmartGroupMember } from '../lib/api-client'
import { ERROR_HINTS, isOk } from '../lib/api-client'
import { initial } from '../lib/format'
import { MemberActions } from '../components/member-actions'
import { spacing as s, type Theme } from '../theme'
import { useTheme } from '../theme-context'

export interface GroupsScreenProps {
  api: ApiClient
  onOpenUser: (handle: string) => void
}

export function createGroupsScreen(props: GroupsScreenProps) {
  return function GroupsScreen() {
    const { api, onOpenUser } = props
    const { theme } = useTheme()
    const styles = useMemo(() => makeStyles(theme), [theme])
    const [groups, setGroups] = useState<SmartGroup[]>([])
    const [options, setOptions] = useState<GroupOption[]>([])
    const [active, setActive] = useState(0)
    const [loaded, setLoaded] = useState(false)
    const [msg, setMsg] = useState('')

    const load = useCallback(async () => {
      const r = await api.smartGroups()
      if (isOk(r)) {
        setGroups(r.data.groups)
        setOptions(r.data.options)
        setMsg('')
      } else {
        setMsg(ERROR_HINTS[r.error.code] ?? r.error.message)
      }
      setLoaded(true)
    }, [api])

    useEffect(() => {
      void load()
    }, [load])

    const activeGroup = groups[active]
    const total = groups.reduce((n, g) => n + g.users.length, 0)

    const header = (
      <View style={styles.header}>
        <Text style={styles.title}>智能分组</Text>
        <Text style={styles.subtitle}>根据资料与最近推文自动归类 · {total} 位关注 · {groups.length} 组</Text>
      </View>
    )

    const chips = (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips} contentContainerStyle={styles.chipsContent}>
        {groups.map((g, i) => (
          <TouchableOpacity
            key={g.id}
            style={[styles.chip, i === active && styles.chipActive]}
            onPress={() => setActive(i)}
          >
            <Text style={[styles.chipText, i === active && styles.chipTextActive]}>
              {g.name} · {g.users.length}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    )

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

    if (groups.length === 0) {
      return (
        <View style={styles.root}>
          {header}
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>暂无分组结果</Text>
            <Text style={styles.emptyHint}>需先同步关注列表与推文。</Text>
          </View>
        </View>
      )
    }

    const renderMember = ({ item: u }: { item: SmartGroupMember }) => (
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
            {u.tweetCount > 0 ? (
              <Text style={styles.rowMeta}>· {u.tweetCount} 条记录</Text>
            ) : null}
          </View>
          {u.bio ? (
            <Text style={styles.rowBio} numberOfLines={1}>
              {u.bio}
            </Text>
          ) : null}
          {u.recentSample ? (
            <Text style={styles.rowSample} numberOfLines={1}>
              「{u.recentSample}」
            </Text>
          ) : null}
          {u.matched.length > 0 ? (
            <View style={styles.tags}>
              {u.matched.map((m) => (
                <Text key={m} style={styles.tag}>
                  {m}
                </Text>
              ))}
            </View>
          ) : null}
          <MemberActions
            api={api}
            userId={u.userId}
            handle={u.handle}
            currentGroup={activeGroup?.id === 'other' ? undefined : activeGroup?.id}
            options={options}
            onChanged={() => void load()}
          />
        </View>
      </TouchableOpacity>
    )

    return (
      <View style={styles.root}>
        {header}
        {msg !== '' ? <Text style={styles.msg}>{msg}</Text> : null}
        {chips}
        <FlatList
          data={activeGroup?.users ?? []}
          keyExtractor={(u) => u.userId ?? u.handle}
          renderItem={renderMember}
        />
      </View>
    )
  }
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  header: { paddingHorizontal: s.lg, paddingVertical: s.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border },
  title: { color: theme.colors.textPrimary, fontSize: theme.fontSize.lg, fontWeight: '800' },
  subtitle: { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm },
  chips: { flexGrow: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border },
  chipsContent: { padding: s.md, gap: s.sm },
  chip: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: s.md,
    paddingVertical: s.sm,
    marginRight: s.sm,
  },
  chipActive: { backgroundColor: theme.colors.userBubbleBg, borderColor: theme.colors.userBubbleBg },
  chipText: { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm },
  chipTextActive: { color: '#fff', fontWeight: '700' },
  msg: { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm, paddingHorizontal: s.lg, paddingVertical: s.sm, backgroundColor: theme.colors.surface },
  loading: { padding: s.xl * 2, alignItems: 'center' },
  empty: { alignItems: 'center', gap: s.sm, padding: s.xl * 2 },
  emptyTitle: { color: theme.colors.textSecondary, fontSize: theme.fontSize.md },
  emptyHint: { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm, textAlign: 'center' },
  row: {
    flexDirection: 'row',
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
  rowMeta: { color: theme.colors.textSecondary, fontSize: theme.fontSize.xs, opacity: 0.7 },
  rowBio: { color: theme.colors.textPrimary, fontSize: theme.fontSize.sm, opacity: 0.8, marginTop: 2 },
  rowSample: { color: theme.colors.textSecondary, fontSize: theme.fontSize.xs, marginTop: 2 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  tag: { color: '#38bdf8', fontSize: theme.fontSize.xs, backgroundColor: 'rgba(56,189,248,0.12)', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1, overflow: 'hidden' },
})