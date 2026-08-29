import { ExternalLink, Eye, Heart, MessageCircle, Repeat2 } from "lucide-react"
import type { Tweet } from "@/lib/api"
import { displayUrl, fmtAgo, fmtCount, imgProxy, initial, splitLinks } from "@/lib/format"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"

/** Twitter 风格推文卡片。 */
export function TweetCard({
  tweet,
  onOpenUser,
}: {
  tweet: Tweet
  /** 点击作者/头像进入其主页。 */
  onOpenUser?: (handle: string) => void
}) {
  const m = tweet.metrics
  const openUser = onOpenUser && tweet.authorHandle ? () => onOpenUser(tweet.authorHandle) : undefined
  return (
    <article className="flex gap-3 border-b border-border px-4 py-3 transition-colors hover:bg-accent/40">
      <button
        type="button"
        onClick={openUser}
        disabled={!openUser}
        className={cn("shrink-0 rounded-full", openUser && "cursor-pointer hover:opacity-90")}
      >
        <Avatar size="lg" className="mt-0.5">
          {tweet.avatarUrl ? <AvatarImage src={imgProxy(tweet.avatarUrl)} alt={tweet.authorHandle} /> : null}
          <AvatarFallback>{initial(tweet.authorName, tweet.authorHandle)}</AvatarFallback>
        </Avatar>
      </button>

      <div className="min-w-0 flex-1">
        {/* 作者行（点击进主页；右侧外链图标打开 X 原主页） */}
        <div className="flex items-baseline gap-1 text-[15px]">
          <button
            type="button"
            onClick={openUser}
            disabled={!openUser}
            className={cn("truncate font-bold text-foreground", openUser && "cursor-pointer hover:underline")}
          >
            {tweet.authorName || "—"}
          </button>
          <button type="button" onClick={openUser} disabled={!openUser} className="truncate text-muted-foreground">
            @{tweet.authorHandle}
          </button>
          {tweet.time ? <span className="shrink-0 text-muted-foreground">· {fmtAgo(tweet.time)}</span> : null}
          {tweet.authorHandle ? (
            <a
              href={`https://x.com/${tweet.authorHandle}`}
              target="_blank"
              rel="noopener noreferrer"
              title={`在 X 打开 @${tweet.authorHandle}`}
              aria-label={`在 X 打开 @${tweet.authorHandle}`}
              className="ml-auto shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-sky-500"
            >
              <ExternalLink className="size-3.5" />
            </a>
          ) : null}
        </div>

        {/* 正文（链接可点击） */}
        <p className="mt-0.5 whitespace-pre-wrap break-words text-[15px] leading-snug text-foreground">
          {splitLinks(tweet.text, tweet.links).map((seg, i) =>
            seg.type === "link" ? (
              <a
                key={i}
                href={seg.expandedUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="break-all text-sky-500 hover:underline"
              >
                {displayUrl(seg.expandedUrl)}
              </a>
            ) : (
              <span key={i}>{seg.value}</span>
            ),
          )}
        </p>

        {/* 互动行（右侧外链图标打开原推文） */}
        <div className="mt-2 flex max-w-md items-center justify-between text-[13px] text-muted-foreground">
          <div className="flex items-center gap-3">
            <Action icon={<MessageCircle className="size-4" />} count={fmtCount(m?.replies)} />
            <Action icon={<Repeat2 className="size-4" />} count={fmtCount(m?.reposts)} />
            <Action icon={<Heart className="size-4" />} count={fmtCount(m?.likes)} hover="hover:text-red-500" />
            <span className="flex items-center gap-1">
              <Eye className="size-4" />
              {fmtCount(m?.views) || "—"}
            </span>
          </div>
          {tweet.url ? (
            <a
              href={tweet.url}
              target="_blank"
              rel="noopener noreferrer"
              title="在 X 打开原推文"
              aria-label="在 X 打开原推文"
              className="shrink-0 rounded-full p-1 transition-colors hover:bg-accent hover:text-sky-500"
            >
              <ExternalLink className="size-4" />
            </a>
          ) : null}
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