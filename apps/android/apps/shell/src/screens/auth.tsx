/**
 * 认证设置屏（对齐 web CookieSetup）：粘贴 cookie → 保存 → 状态展示。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import type { ApiClient } from '../lib/api-client'
import { ERROR_HINTS, isOk } from '../lib/api-client'
import { spacing as s, type Theme } from '../theme'
import { useTheme } from '../theme-context'

export interface AuthScreenProps {
  api: ApiClient
  /** cookie 保存成功后通知装配器切换。 */
  onAuthChanged: () => void
  /** 从设置页覆层进入时提供返回；首启全屏认证无返回。 */
  onBack?: () => void
}

export function createAuthScreen(props: AuthScreenProps) {
  return function AuthScreen() {
    const { api, onAuthChanged, onBack } = props
    const { theme } = useTheme()
    const styles = useMemo(() => makeStyles(theme), [theme])
    const [cookie, setCookie] = useState('')
    const [saving, setSaving] = useState(false)
    const [line, setLine] = useState('')
    const [detail, setDetail] = useState('')

    const check = useCallback(async () => {
      const r = await api.credentialStatus()
      if (isOk(r)) {
        setLine(r.data.configured ? '已配置 ✔' : '未配置')
        setDetail(`source=${r.data.source} · keys=${r.data.keys.join(',')}`)
      } else {
        setLine('状态读取失败')
        setDetail(r.error.message)
      }
    }, [api])

    useEffect(() => {
      void check()
    }, [check])

    const save = useCallback(async () => {
      if (!cookie.trim() || saving) return
      setSaving(true)
      const r = await api.saveCredential(cookie.trim())
      if (isOk(r)) {
        setCookie('')
        onAuthChanged()
      } else {
        setLine('保存失败（' + r.error.code + '）')
        setDetail(ERROR_HINTS[r.error.code] ?? r.error.message)
      }
      setSaving(false)
    }, [api, cookie, saving, onAuthChanged])

    return (
      <View style={styles.root}>
        <View style={styles.brand}>
          {onBack ? (
            <TouchableOpacity onPress={onBack} accessibilityLabel="返回">
              <Text style={styles.backText}>← 返回</Text>
            </TouchableOpacity>
          ) : null}
          <Text style={styles.brandText}>𝕏 twibot</Text>
          <Text style={styles.brandSub}>认证设置 · 粘贴 X Cookie</Text>
        </View>
        <ScrollView contentContainerStyle={styles.body}>
          <TextInput
            style={styles.input}
            value={cookie}
            onChangeText={setCookie}
            placeholder={'auth_token=xxx; ct0=yyy; …'}
            placeholderTextColor={theme.colors.textSecondary}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TouchableOpacity style={[styles.btn, (saving || !cookie.trim()) && styles.btnDisabled]} onPress={() => void save()} disabled={saving || !cookie.trim()}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>保存 Cookie</Text>}
          </TouchableOpacity>

          <View style={styles.card}>
            <Text style={styles.cardValue}>{line}</Text>
            {detail !== '' ? <Text style={styles.cardDetail}>{detail}</Text> : null}
          </View>
          <TouchableOpacity style={styles.chip} onPress={() => void check()}>
            <Text style={styles.chipText}>重新检测</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    )
  }
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.background },
    brand: { padding: s.xl, paddingTop: s.xl * 1.5, gap: s.xs },
    backText: { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm, marginBottom: s.sm },
    brandText: { color: theme.colors.primary, fontSize: 24, fontWeight: '800' },
    brandSub: { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm, marginTop: s.xs },
    body: { padding: s.xl, gap: s.md },
    input: {
      minHeight: 110,
      backgroundColor: theme.colors.inputBg,
      borderColor: theme.colors.inputBorder,
      borderWidth: 1,
      borderRadius: theme.radius.md,
      padding: s.md,
      color: theme.colors.textPrimary,
      fontFamily: 'monospace',
      fontSize: theme.fontSize.sm,
      textAlignVertical: 'top',
    },
    btn: {
      backgroundColor: theme.colors.userBubbleBg,
      borderRadius: theme.radius.md,
      paddingVertical: s.md,
      alignItems: 'center',
    },
    btnDisabled: { opacity: 0.5 },
    btnText: { color: '#fff', fontWeight: '700', fontSize: theme.fontSize.md },
    card: {
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.border,
      borderWidth: 1,
      borderRadius: theme.radius.md,
      padding: s.md,
      gap: s.xs,
    },
    cardValue: { color: theme.colors.textPrimary, fontSize: theme.fontSize.md, fontWeight: '600' },
    cardDetail: { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm },
    chip: {
      alignSelf: 'flex-start',
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.border,
      borderWidth: 1,
      borderRadius: theme.radius.sm,
      paddingHorizontal: s.md,
      paddingVertical: s.sm,
    },
    chipText: { color: theme.colors.textSecondary, fontSize: theme.fontSize.sm },
  })
