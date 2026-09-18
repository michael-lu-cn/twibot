import { Home, Users, Tags, Bookmark, Settings } from "lucide-react"
import type { CredentialStatus } from "@/lib/api"
import { cn } from "@/lib/utils"

export type TabKey = "home" | "following" | "groups" | "bookmarks" | "auth" | "settings"

export const SOURCE_LABEL: Record<string, string> = {
  env: "环境变量",
  file: "已保存 cookie",
  cdp: "CDP 直连",
  none: "未配置",
}

/** Twitter 风格左侧导航。 */
export function Sidebar({
  active,
  onSelect,
  status,
}: {
  active: TabKey
  onSelect: (t: TabKey) => void
  status: CredentialStatus | null
}) {
  const dot = !status
    ? "bg-gray-400"
    : status.configured
      ? "bg-emerald-500"
      : "bg-red-500"

  return (
    <aside className="sticky top-0 h-screen w-[275px] shrink-0 flex-col px-3 py-2">
      <div className="flex h-14 items-center px-3">
        <span className="text-[30px] font-extrabold leading-none">𝕏</span>
      </div>

      <nav className="flex flex-col gap-1">
        <NavItem active={active === "home"} icon={<Home className="size-6" />} label="主页" onClick={() => onSelect("home")} />
        <NavItem active={active === "following"} icon={<Users className="size-6" />} label="关注" onClick={() => onSelect("following")} />
        <NavItem active={active === "groups"} icon={<Tags className="size-6" />} label="智能分组" onClick={() => onSelect("groups")} />
        <NavItem active={active === "bookmarks"} icon={<Bookmark className="size-6" />} label="书签" onClick={() => onSelect("bookmarks")} />
        <NavItem active={active === "settings"} icon={<Settings className="size-6" />} label="设置" onClick={() => onSelect("settings")} />
      </nav>

      <div className="mt-auto flex items-center gap-3 rounded-full p-3 hover:bg-accent/60">
        <span className={cn("size-2.5 rounded-full", dot)} />
        <div className="min-w-0">
          <p className="truncate text-[14px] font-bold">twibot</p>
          <p className="truncate text-[13px] text-muted-foreground">
            {status ? SOURCE_LABEL[status.source] ?? status.source : "检测中…"}
          </p>
        </div>
      </div>
    </aside>
  )
}

function NavItem({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean
  icon: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-4 rounded-full px-4 py-3 text-left text-xl transition-colors hover:bg-accent/70",
        active ? "font-bold" : "font-normal text-foreground",
      )}
    >
      {icon}
      <span className="hidden @3xl:inline lg:inline">{label}</span>
    </button>
  )
}