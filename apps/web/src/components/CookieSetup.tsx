import { useState } from "react"
import { KeyRound } from "lucide-react"
import { api, isOk, ERROR_HINTS } from "@/lib/api"
import { Button } from "@/components/ui/button"

/** Cookie 配置视图：粘贴三格式 + 保存。 */
export function CookieSetup({ onSaved }: { onSaved: () => Promise<void> }) {
  const [cookie, setCookie] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  async function save() {
    if (!cookie.trim()) {
      setError("请先粘贴 cookie")
      return
    }
    setSaving(true)
    setError(null)
    setOk(false)
    const r = await api.saveCredential(cookie)
    if (isOk(r)) {
      setOk(true)
      await onSaved()
    } else {
      const hint = ERROR_HINTS[r.error.code] ?? r.error.message
      setError(`${hint}（${r.error.message}）`)
    }
    setSaving(false)
  }

  return (
    <div className="mx-auto w-full max-w-xl px-6 py-10">
      <div className="mb-2 flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <KeyRound className="size-5" />
        </span>
        <h2 className="text-xl font-bold">设置 X 登录 cookie</h2>
      </div>
      <p className="mb-4 text-[14px] leading-relaxed text-muted-foreground">
        将浏览器里复制的内容粘贴到下方，支持三种格式：
        <br />
        ① <b>Cookie 头</b>：DevTools → 请求头里的 <code>auth_token=…; ct0=…</code>；
        <br />② <b>cURL 文本</b>：网络请求右键 → Copy as cURL；
        <br />③ <b>JSON 数组</b>：<code>[{"{"}"name":"auth_token",…{"}"}]</code>。
      </p>
      <textarea
        value={cookie}
        onChange={(e) => setCookie(e.target.value)}
        placeholder="粘贴 cookie 头 / cURL / JSON…"
        className="h-28 w-full resize-y rounded-xl border border-input bg-transparent px-4 py-3 text-[13px] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
      />
      {error ? <p className="mt-2 text-[13px] text-destructive">{error}</p> : null}
      {ok ? <p className="mt-2 text-[13px] text-emerald-600">已保存，可回到「主页」同步推荐流。</p> : null}
      <Button onClick={save} disabled={saving} className="mt-4 rounded-full">
        {saving ? "保存中…" : "保存"}
      </Button>
    </div>
  )
}