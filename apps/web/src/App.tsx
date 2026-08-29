import { useEffect, useRef, useState } from "react"
import { api, isOk, type CredentialStatus } from "@/lib/api"
import { parseHash, applyRoute, type Route } from "@/lib/router"
import { Sidebar, type TabKey } from "@/components/Sidebar"
import { FeedView } from "@/components/FeedView"
import { FollowingView } from "@/components/FollowingView"
import { GroupsView } from "@/components/GroupsView"
import { BookmarksView } from "@/components/BookmarksView"
import { UserProfileView } from "@/components/UserProfileView"
import { CookieSetup } from "@/components/CookieSetup"

/** 应用外壳：Twitter 风格三栏（侧边导航 + 主列），导航与 URL hash 双向同步。 */
export default function App() {
  const [status, setStatus] = useState<CredentialStatus | null>(null)
  const [route, setRoute] = useState<Route>(() => parseHash())
  // 进入用户主页前的页签，点「返回」时回到该页（浏览器后退仍由历史记录接管）
  const lastTabRef = useRef<TabKey>("home")

  // 首次进入补齐 URL（无 hash 时落到 #/home）
  useEffect(() => {
    if (!window.location.hash) applyRoute({ tab: "home" })
  }, [])

  // URL 变化（前进/后退/手动改 hash）→ 同步路由状态
  useEffect(() => {
    const onHash = () => setRoute(parseHash())
    window.addEventListener("hashchange", onHash)
    return () => window.removeEventListener("hashchange", onHash)
  }, [])

  async function refreshStatus() {
    const r = await api.credentialStatus()
    if (isOk(r)) setStatus(r.data)
  }

  useEffect(() => {
    void refreshStatus()
  }, [])

  const goTab = (tab: TabKey) => {
    lastTabRef.current = tab
    applyRoute({ tab })
  }

  const goUser = (handle: string | null) => {
    applyRoute(handle ? { tab: lastTabRef.current, userHandle: handle } : { tab: lastTabRef.current })
  }

  const { tab, userHandle } = route
  const showSetup = tab === "auth" || (tab === "home" && status !== null && !status.configured)

  let main: React.ReactNode
  if (userHandle) {
    main = <UserProfileView handle={userHandle} onBack={() => goUser(null)} onOpenUser={goUser} />
  } else if (showSetup) {
    main = <CookieSetup onSaved={refreshStatus} />
  } else if (tab === "following") {
    main = <FollowingView onOpenUser={goUser} />
  } else if (tab === "groups") {
    main = <GroupsView onOpenUser={goUser} />
  } else if (tab === "bookmarks") {
    main = <BookmarksView onOpenUser={goUser} />
  } else {
    main = <FeedView onOpenUser={goUser} />
  }

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <Sidebar active={userHandle ? lastTabRef.current : tab} onSelect={goTab} status={status} />
      {main}
    </div>
  )
}