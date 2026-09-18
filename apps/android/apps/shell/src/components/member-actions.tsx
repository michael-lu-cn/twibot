/**
 * 用户行操作（对齐 web MemberActions）：改分组（弹层） + 取关。
 */
import React, { useMemo, useState } from 'react'
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import type { ApiClient, GroupOption } from '../lib/api-client'
import { isOk } from '../lib/api-client'
import { spacing as s, type Theme } from '../theme'
import { useTheme } from '../theme-context'

export function MemberActions({
  api,
  userId,
  handle,
  currentGroup,
  options,
  onChanged,
}: {
  api: ApiClient
  userId: string
  handle: string
  currentGroup?: string
  options: GroupOption[]
  onChanged: () => void
}) {
  const { theme } = useTheme()
  const styles = useMemo(() => makeStyles(theme), [theme])
  const [open, setOpen] = useState(false)

  const choose = async (groupKey: string) => {
    setOpen(false)
    const r = await api.setGroupOverride(userId, groupKey)
    if (isOk(r)) onChanged()
  }

  const unfollow = async () => {
    setOpen(false)
    const r = await api.unfollow(handle)
    if (isOk(r)) onChanged()
  }

  return (
    <>
      <TouchableOpacity style={styles.btn} onPress={() => setOpen(true)}>
        <Text style={styles.btnText}>⚡ 操作</Text>
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setOpen(false)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>@{handle}</Text>
            <Text style={styles.sheetSub}>当前分组：{currentGroup ?? '未分组'}</Text>
            {options.map((o) => (
              <TouchableOpacity
                key={o.id}
                style={[styles.option, o.id === currentGroup && styles.optionActive]}
                onPress={() => void choose(o.id)}
              >
                <Text style={[styles.optionText, o.id === currentGroup && styles.optionTextActive]}>{o.name}</Text>
              </TouchableOpacity>
            ))}
            <View style={styles.divider} />
            <TouchableOpacity style={styles.danger} onPress={() => void unfollow()}>
              <Text style={styles.dangerText}>取关 @{handle}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancel} onPress={() => setOpen(false)}>
              <Text style={styles.cancelText}>取消</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  )
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  btn: {
    alignSelf: 'flex-start',
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: theme.radius.sm,
    paddingHorizontal: s.md,
    paddingVertical: s.xs + 2,
    marginTop: s.sm,
  },
  btnText: { color: theme.colors.textSecondary, fontSize: theme.fontSize.xs },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: theme.colors.surface,
    borderTopLeftRadius: theme.radius.lg,
    borderTopRightRadius: theme.radius.lg,
    padding: s.lg,
    gap: s.sm,
  },
  sheetTitle: { color: theme.colors.textPrimary, fontSize: theme.fontSize.md, fontWeight: '800' },
  sheetSub: { color: theme.colors.textSecondary, fontSize: theme.fontSize.xs },
  option: {
    borderRadius: theme.radius.sm,
    paddingVertical: s.md,
    paddingHorizontal: s.md,
    backgroundColor: theme.colors.background,
  },
  optionActive: { backgroundColor: 'rgba(154,160,255,0.15)' },
  optionText: { color: theme.colors.textPrimary, fontSize: theme.fontSize.md },
  optionTextActive: { color: theme.colors.primary, fontWeight: '700' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.border, marginVertical: s.xs },
  danger: { paddingVertical: s.md, alignItems: 'center' },
  dangerText: { color: theme.colors.error, fontSize: theme.fontSize.md, fontWeight: '700' },
  cancel: {
    paddingVertical: s.md,
    alignItems: 'center',
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.background,
  },
  cancelText: { color: theme.colors.textSecondary, fontSize: theme.fontSize.md },
})