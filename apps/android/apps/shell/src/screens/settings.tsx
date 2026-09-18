/**
 * 设置屏：外观（主题三态，默认跟随系统）+ 账号与认证入口。
 * 语义对齐 web 版 SettingsView。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import type { ApiClient } from '../lib/api-client'
import { isOk } from '../lib/api-client'
import { spacing as s, THEME_MODE_OPTIONS, type Theme } from '../theme'
import { useTheme } from '../theme-context'

export interface SettingsScreenProps {
  api: ApiClient
  /** 打开认证屏（粘贴/更新 cookie）。 */
  onOpenAuth: () => void
}

export function createSettingsScreen(props: SettingsScreenProps) {
  return function SettingsScreen() {
    const { api, onOpenAuth } = props
    const { mode, scheme, setMode, theme } = useTheme()
    const styles = useMemo(() => makeStyles(theme), [theme])
    const [status, setStatus] = useState('检测中…')

    const check = useCallback(async () => {
      const r = await api.credentialStatus()
      if (isOk(r)) {
        setStatus(r.data.configured ? `已配置 · ${r.data.source}` : '未配置')
      } else {
        setStatus('状态读取失败')
      }
    }, [api])

    useEffect(() => {
      void check()
    }, [check])

    return (
      <View style={styles.root}>
        <View style={styles.header}>
          <Text style={styles.title}>设置</Text>
          <Text style={styles.subtitle}>外观与账号</Text>
        </View>
        <ScrollView contentContainerStyle={styles.body}>
          <Text style={styles.sectionTitle}>外观</Text>
          <Text style={styles.sectionHint}>
            默认跟随系统；当前为「{scheme === 'dark' ? '深色' : '浅色'}」。
          </Text>
          <View style={styles.group}>
            {THEME_MODE_OPTIONS.map((option, index) => {
              const active = mode === option.value
              return (
                <TouchableOpacity
                  key={option.value}
                  style={[styles.option, index > 0 && styles.optionBordered]}
                  onPress={() => setMode(option.value)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                >
                  <View style={styles.optionText}>
                    <Text style={styles.optionLabel}>{option.label}</Text>
                    <Text style={styles.optionHint}>{option.hint}</Text>
                  </View>
                  {active ? <Text style={styles.check}>✓</Text> : null}
                </TouchableOpacity>
              )
            })}
          </View>

          <Text style={[styles.sectionTitle, styles.sectionGap]}>账号与认证</Text>
          <Text style={styles.sectionHint}>cookie 状态：{status}</Text>
          <TouchableOpacity style={styles.chip} onPress={onOpenAuth}>
            <Text style={styles.chipText}>重新粘贴 Cookie</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    )
  }
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.background },
    header: {
      paddingHorizontal: s.lg,
      paddingVertical: s.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.border,
    },
    title: { color: theme.colors.textPrimary, fontSize: theme.fontSize.lg, fontWeight: '800' },
    subtitle: { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm },
    body: { padding: s.lg, gap: s.sm },
    sectionTitle: {
      color: theme.colors.textPrimary,
      fontSize: theme.fontSize.md,
      fontWeight: '800',
      marginTop: s.sm,
    },
    sectionGap: { marginTop: s.xl },
    sectionHint: { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm },
    group: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.radius.md,
      overflow: 'hidden',
      marginTop: s.xs,
    },
    option: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: s.md,
      paddingHorizontal: s.md,
      paddingVertical: s.md,
      backgroundColor: theme.colors.surface,
    },
    optionBordered: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.border,
    },
    optionText: { flex: 1 },
    optionLabel: { color: theme.colors.textPrimary, fontSize: theme.fontSize.md, fontWeight: '700' },
    optionHint: { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm, marginTop: 2 },
    check: { color: theme.colors.primary, fontSize: theme.fontSize.lg, fontWeight: '800' },
    chip: {
      alignSelf: 'flex-start',
      backgroundColor: theme.colors.userBubbleBg,
      borderRadius: theme.radius.md,
      paddingHorizontal: s.lg,
      paddingVertical: s.sm,
      marginTop: s.xs,
    },
    chipText: { color: theme.colors.userBubbleText, fontSize: theme.fontSize.sm, fontWeight: '700' },
  })
