import { useEffect, useState } from "react"
import { api, isOk, type CredentialStatus } from "@/lib/api"
import { Sidebar, type TabKey } from "@/components/Sidebar"
import { FeedView } from "@/components/FeedView"
import { FollowingView } from "@/components/FollowingView"
import { GroupsView } from "@/components/GroupsView"
import { BookmarksView } from "@/components/BookmarksView"
import { UserProfileView } from "@/components/UserProfileView"
import { CookieSetup } from "@/components/CookieSetup"

/** 应用外壳：Twitter 风格三栏（侧边导航 + 主列）。 */
export default function App() {
  const [status, setStatus] = useState<CredentialStatus | null>(null)
  const [tab, setTab] = useState<TabKey>("home")
  const [userHandle, setUserHandle] = useState<string | null>(null)

  async function refreshStatus() {
    const r = await api.credentialStatus()
    if (isOk(r)) setStatus(r.data)
  }

  useEffect(() => {
    void refreshStatus()
  }, [])

  const showSetup = tab === "auth" || (tab === "home" && status !== null && !status.configured)

  let main: React.ReactNode
  if (userHandle) {
    main = <UserProfileView handle={userHandle} onBack={() => setUserHandle(null)} onOpenUser={setUserHandle} />
  } else if (showSetup) {
    main = <CookieSetup onSaved={refreshStatus} />
  } else if (tab === "following") {
    main = <FollowingView onOpenUser={setUserHandle} />
  } else if (tab === "groups") {
    main = <GroupsView onOpenUser={setUserHandle} />
  } else if (tab === "bookmarks") {
    main = <BookmarksView onOpenUser={setUserHandle} />
  } else {
    main = <FeedView onOpenUser={setUserHandle} />
  }

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <Sidebar active={tab} onSelect={setTab} status={status} />
      {main}
    </div>
  )
}