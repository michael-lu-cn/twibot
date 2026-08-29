import { useState } from "react"
import { UserMinus } from "lucide-react"
import { api, isOk, type GroupOption } from "@/lib/api"

/**
 * 成员卡片操作区：取关（X 真实操作，带确认）+ 改分组（手动覆盖自动分组）。
 * currentGroup 传当前所在组 id；options 为可选分组（含「未分组」）。
 */
export function MemberActions({
  userId,
  handle,
  currentGroup,
  options,
  onChanged,
}: {
  userId: string
  handle: string
  currentGroup?: string
  options: GroupOption[]
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function unfollow() {
    if (busy) return
    if (!window.confirm(`确认在 X 上取消关注 @${handle}？此操作会真实改变你的关注，不可撤销。`)) return
    setBusy(true)
    setErr(null)
    const r = await api.unfollow(handle)
    setBusy(false)
    if (isOk(r)) {
      onChanged()
    } else {
      setErr(r.error.message)
    }
  }

  async function changeGroup(e: React.ChangeEvent<HTMLSelectElement>) {
    if (busy) return
    setBusy(true)
    setErr(null)
    const r = await api.setGroupOverride(userId, e.target.value)
    setBusy(false)
    if (isOk(r)) {
      onChanged()
    } else {
      setErr(r.error.message)
    }
  }

  return (
    <div className="mt-1.5 flex items-center gap-2">
      <select
        value={currentGroup ?? ""}
        onChange={changeGroup}
        disabled={busy}
        onClick={(e) => e.stopPropagation()}
        className="h-6 max-w-[9rem] cursor-pointer rounded-full border border-border bg-background px-1.5 text-[11px] text-muted-foreground hover:bg-accent/50"
        title="改分组"
      >
        <option value="" disabled>
          {(options.find((o) => o.id === currentGroup)?.name ?? "自动") + " · 改分组"}
        </option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          void unfollow()
        }}
        disabled={busy}
        className="flex h-6 items-center gap-1 rounded-full border border-border px-2 text-[11px] text-muted-foreground transition-colors hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-500"
        title={`取关 @${handle}`}
      >
        <UserMinus className="size-3" />
        取关
      </button>
      {err ? <span className="truncate text-[11px] text-destructive">{err}</span> : null}
    </div>
  )
}