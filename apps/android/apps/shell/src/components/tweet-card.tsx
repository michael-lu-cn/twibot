/**
 * 推文卡片（RN 版）：语义对齐 web 版 TweetCard。
 * 作者行点击 → 应用内用户主页；右侧外链图标 → X 原网页/原推文。
 */
import React from 'react'
import { Image, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import type { Tweet } from '../lib/api-client'
import { displayUrl, fmtAgo, fmtCount, initial, splitLinks } from '../lib/format'
import { theme } from '../theme'

export function TweetCard({
  tweet,
  onOpenUser,
  imgProxyUrl,
}: {
  tweet: Tweet
  onOpenUser?: (handle: string) => void
  /** 图片代理 URL 构造（由上层按宿主 baseUrl 注入）。 */
  imgProxyUrl?: (url: string | undefined | null) => string | undefined
}) {
  const m = tweet.metrics
  const avatarUri = tweet.avatarUrl && imgProxyUrl ? imgProxyUrl(tweet.avatarUrl) : undefined
  const segments = splitLinks(tweet.text, tweet.links)

  return (
    <View style={styles.card}>
      <TouchableOpacity
        style={styles.avatarWrap}
        disabled={!onOpenUser || !tweet.authorHandle}
        onPress={() => onOpenUser?.(tweet.authorHandle)}
      >
        {avatarUri ? (
          <Image source={{ uri: avatarUri }} style={styles.avatar} defaultSource={undefined} />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback]}>
            <Text style={styles.avatarFallbackText}>{initial(tweet.authorName, tweet.authorHandle)}</Text>
          </View>
        )}
      </TouchableOpacity>

      <View style={styles.body}>
        {/* 作者行：点击进应用内主页；右侧外链进 X 原主页 */}
        <View style={styles.authorRow}>
          <TouchableOpacity
            disabled={!onOpenUser || !tweet.authorHandle}
            onPress={() => onOpenUser?.(tweet.authorHandle)}
            style={styles.authorNames}
          >
            <Text style={styles.name} numberOfLines={1}>
              {tweet.authorName || '—'}
            </Text>
            <Text style={styles.handle} numberOfLines={1}>
              @{tweet.authorHandle}
            </Text>
            {tweet.time ? (
              <Text style={styles.time}>
                {' · '}
                {fmtAgo(tweet.time)}
              </Text>
            ) : null}
          </TouchableOpacity>
          {tweet.authorHandle ? (
            <TouchableOpacity
              onPress={() => void Linking.openURL(`https://x.com/${tweet.authorHandle}`)}
              style={styles.iconBtn}
              accessibilityLabel={`在 X 打开 @${tweet.authorHandle}`}
            >
              <Text style={styles.extIcon}>⤴</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {/* 正文（链接可点） */}
        <Text style={styles.text}>
          {segments.map((seg, i) =>
            seg.type === 'link' ? (
              <Text
                key={i}
                style={styles.link}
                onPress={() => void Linking.openURL(seg.expandedUrl)}
              >
                {displayUrl(seg.expandedUrl)}
              </Text>
            ) : (
              <Text key={i}>{seg.value}</Text>
            ),
          )}
        </Text>

        {/* 互动行：右侧外链进原推文 */}
        <View style={styles.metricsRow}>
          <Text style={styles.metric}>🔁 {fmtCount(m?.reposts) || '—'}</Text>
          <Text style={styles.metric}>❤ {fmtCount(m?.likes) || '—'}</Text>
          <Text style={styles.metric}>👁 {fmtCount(m?.views) || '—'}</Text>
          {tweet.url ? (
            <TouchableOpacity
              onPress={() => void Linking.openURL(tweet.url!)}
              style={[styles.iconBtn, styles.tweetExt]}
              accessibilityLabel="在 X 打开原推文"
            >
              <Text style={styles.extIcon}>⤴</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </View>
  )
}

const s = theme.spacing
const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    gap: s.md,
    paddingHorizontal: s.lg,
    paddingVertical: s.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  avatarWrap: { paddingTop: 2 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: theme.colors.surface },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarFallbackText: { color: theme.colors.textSecondary, fontSize: theme.fontSize.lg, fontWeight: '700' },
  body: { flex: 1, minWidth: 0 },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: s.xs },
  authorNames: { flex: 1, flexDirection: 'row', alignItems: 'baseline', gap: s.xs, minWidth: 0 },
  name: { color: theme.colors.textPrimary, fontWeight: '700', fontSize: theme.fontSize.md, flexShrink: 1 },
  handle: { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm, flexShrink: 1 },
  time: { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm },
  iconBtn: { padding: s.xs, marginLeft: 'auto' },
  tweetExt: { marginLeft: s.sm },
  extIcon: { color: theme.colors.textSecondary, fontSize: theme.fontSize.md },
  text: { color: theme.colors.textPrimary, fontSize: theme.fontSize.md, lineHeight: 21, marginTop: 2 },
  link: { color: '#38bdf8' },
  metricsRow: { flexDirection: 'row', alignItems: 'center', gap: s.lg, marginTop: s.sm },
  metric: { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm },
})