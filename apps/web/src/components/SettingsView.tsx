import { Check, KeyRound, Settings as SettingsIcon } from "lucide-react"
import type { CredentialStatus } from "@/lib/api"
import { THEME_OPTIONS } from "@/lib/theme"
import { useTheme } from "@/lib/theme-context"
import { cn } from "@/lib/utils"
import { SOURCE_LABEL } from "@/components/Sidebar"

/** 设置主视图：外观（主题，默认跟随系统）+ 账号与认证入口。 */
export function SettingsView({
  status,
  onOpenAuth,
}: {
  status: CredentialStatus | null
  onOpenAuth: () => void
}) {
  const { mode, theme, setMode } = useTheme()
  const configured = status?.configured ?? false

  return (
    <div className="min-w-0 flex-1 border-x border-border">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background/80 px-4 py-3 backdrop-blur">
        <SettingsIcon className="size-5" />
        <h1 className="text-xl font-bold">设置</h1>
      </header>

      <section className="border-b border-border px-4 py-5">
        <h2 className="text-[15px] font-bold">外观</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          默认跟随系统；当前为「{theme === "dark" ? "深色" : "浅色"}」。
        </p>

        <div
          role="radiogroup"
          aria-label="主题"
          className="mt-3 overflow-hidden rounded-2xl border border-border"
        >
          {THEME_OPTIONS.map((option) => {
            const active = mode === option.value
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setMode(option.value)}
                className={cn(
                  "flex w-full items-center gap-3 border-b border-border px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-accent/60",
                  active && "bg-accent/40",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold">{option.label}</span>
                  <span className="block text-[13px] text-muted-foreground">{option.hint}</span>
                </span>
                {active ? <Check className="size-5 shrink-0 text-primary" /> : null}
              </button>
            )
          })}
        </div>
      </section>

      <section className="px-4 py-5">
        <h2 className="text-[15px] font-bold">账号与认证</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {status
            ? configured
              ? `已配置 · ${SOURCE_LABEL[status.source] ?? status.source}`
              : "未配置 cookie，无法同步推荐流"
            : "检测中…"}
        </p>
        <button
          type="button"
          onClick={onOpenAuth}
          className="mt-3 inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-[14px] font-semibold transition-colors hover:bg-accent/60"
        >
          <KeyRound className="size-4" />
          {configured ? "重新粘贴 Cookie" : "设置 Cookie"}
        </button>
      </section>
    </div>
  )
}
