import { useEffect, useState } from "react"
import { api, isOk, type CredentialStatus } from "@/lib/api"
import { Sidebar, type TabKey } from "@/components/Sidebar"
import { FeedView } from "@/components/FeedView"
import { FollowingView } from "@/components/FollowingView"
import { CookieSetup } from "@/components/CookieSetup"

/** 应用外壳：Twitter 风格三栏（侧边导航 + 主列）。 */
export default function App() {
  const [status, setStatus] = useState<CredentialStatus | null>(null)
  const [tab, setTab] = useState<TabKey>("home")

  async function refreshStatus() {
    const r = await api.credentialStatus()
    if (isOk(r)) setStatus(r.data)
  }

  useEffect(() => {
    void refreshStatus()
  }, [])

  const showSetup = tab === "auth" || (tab === "home" && status !== null && !status.configured)

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <Sidebar active={tab} onSelect={setTab} status={status} />
      {showSetup ? <CookieSetup onSaved={refreshStatus} /> : tab === "following" ? <FollowingView /> : <FeedView />}
    </div>
  )
}