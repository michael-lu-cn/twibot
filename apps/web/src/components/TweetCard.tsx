import { Eye, Heart, MessageCircle, Repeat2 } from "lucide-react"
import type { Tweet } from "@/lib/api"
import { fmtAgo, fmtCount, imgProxy, initial } from "@/lib/format"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"

/** Twitter 风格推文卡片。 */
export function TweetCard({ tweet }: { tweet: Tweet }) {
  const m = tweet.metrics
  return (
    <article className="flex gap-3 border-b border-border px-4 py-3 transition-colors hover:bg-accent/40">
      <Avatar size="lg" className="mt-0.5 shrink-0">
        {tweet.avatarUrl ? <AvatarImage src={imgProxy(tweet.avatarUrl)} alt={tweet.authorHandle} /> : null}
        <AvatarFallback>{initial(tweet.authorName, tweet.authorHandle)}</AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        {/* 作者行 */}
        <div className="flex items-baseline gap-1 text-[15px]">
          <span className="truncate font-bold text-foreground">{tweet.authorName || "—"}</span>
          <span className="truncate text-muted-foreground">@{tweet.authorHandle}</span>
          {tweet.time ? <span className="shrink-0 text-muted-foreground">· {fmtAgo(tweet.time)}</span> : null}
        </div>

        {/* 正文 */}
        <p className="mt-0.5 whitespace-pre-wrap break-words text-[15px] leading-snug text-foreground">
          {tweet.text}
        </p>

        {/* 互动行 */}
        <div className="mt-2 flex max-w-md items-center justify-between text-[13px] text-muted-foreground">
          <Action icon={<MessageCircle className="size-4" />} count={fmtCount(m?.replies)} />
          <Action icon={<Repeat2 className="size-4" />} count={fmtCount(m?.reposts)} />
          <Action icon={<Heart className="size-4" />} count={fmtCount(m?.likes)} hover="hover:text-red-500" />
          <span className="flex items-center gap-1">
            <Eye className="size-4" />
            {fmtCount(m?.views) || "—"}
          </span>
        </div>
      </div>
    </article>
  )
}

function Action({ icon, count, hover }: { icon: React.ReactNode; count: string; hover?: string }) {
  const visible = count !== ""
  return (
    <span className={cn("flex items-center gap-1.5 transition-colors hover:text-sky-500", hover)}>
      {icon}
      {visible ? count : null}
    </span>
  )
}