/**
 * 底部导航（Android 版左侧栏）：主页/关注/分组/书签/设置。
 */
import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { theme } from '../theme'

export type AppTab = 'home' | 'following' | 'groups' | 'bookmarks' | 'settings'

const TABS: Array<{ key: AppTab; icon: string; label: string }> = [
  { key: 'home', icon: '🏠', label: '主页' },
  { key: 'following', icon: '👥', label: '关注' },
  { key: 'groups', icon: '🏷', label: '分组' },
  { key: 'bookmarks', icon: '🔖', label: '书签' },
  { key: 'settings', icon: '⚙', label: '设置' },
]

export function TabBar({ active, onSelect }: { active: AppTab; onSelect: (t: AppTab) => void }) {
  return (
    <View style={styles.bar}>
      {TABS.map((t) => {
        const on = active === t.key
        return (
          <TouchableOpacity key={t.key} style={styles.item} onPress={() => onSelect(t.key)}>
            <Text style={[styles.icon, on && styles.iconOn]}>{t.icon}</Text>
            <Text style={[styles.label, on && styles.labelOn]}>{t.label}</Text>
          </TouchableOpacity>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    paddingVertical: theme.spacing.xs,
  },
  item: { flex: 1, alignItems: 'center', gap: 2 },
  icon: { fontSize: 18, opacity: 0.65 },
  iconOn: { opacity: 1 },
  label: { color: theme.colors.textSecondary, fontSize: theme.fontSize.xs },
  labelOn: { color: theme.colors.primary, fontWeight: '700' },
})