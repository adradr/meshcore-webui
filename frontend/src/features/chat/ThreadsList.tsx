import { Link } from "react-router-dom"
import { ArrowDownLeft, ArrowUpRight, MessagesSquare } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useContacts } from "@/features/contacts/queries"
import { useChannels } from "@/features/channels/queries"
import { useThreads, type Thread } from "./queries"

function relativeTime(iso: string | null): string {
  if (!iso) return ""
  const d = new Date(iso).getTime()
  if (Number.isNaN(d)) return ""
  const diff = Date.now() - d
  if (diff < 0) return "now"
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  const day = Math.floor(hr / 24)
  if (day === 1) return "yesterday"
  if (day < 7) return `${day}d`
  return new Date(iso).toLocaleDateString()
}

function truncate(s: string, n = 100): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…"
}

interface ThreadRowProps {
  thread: Thread
  title: string
  href: string
}

function ThreadRow({ thread, title, href }: ThreadRowProps) {
  const dirIcon =
    thread.last_direction === "out" ? (
      <ArrowUpRight className="h-3.5 w-3.5 shrink-0 opacity-70" aria-label="sent" />
    ) : (
      <ArrowDownLeft className="h-3.5 w-3.5 shrink-0 opacity-70" aria-label="received" />
    )
  const unread = thread.unread_count > 0
  return (
    <Link to={href} className="block focus:outline-none">
      <Card size="sm" className="transition-colors hover:bg-muted/50">
        <CardContent className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span
                className={`truncate ${unread ? "font-semibold" : "font-medium"}`}
              >
                {title}
              </span>
            </div>
            <div
              className={`mt-0.5 flex items-center gap-1 text-xs ${
                unread ? "text-foreground" : "text-muted-foreground"
              }`}
            >
              {dirIcon}
              <span
                className={`truncate ${unread ? "font-medium" : ""}`}
              >
                {truncate(thread.last_text)}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <time
              className={`text-xs ${
                unread ? "text-primary font-medium" : "text-muted-foreground"
              }`}
              dateTime={thread.last_timestamp ?? undefined}
            >
              {relativeTime(thread.last_timestamp)}
            </time>
            {unread && (
              <span
                className="flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold leading-none text-primary-foreground"
                aria-label={`${thread.unread_count} unread`}
              >
                {thread.unread_count > 99 ? "99+" : thread.unread_count}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}

export function ThreadsList() {
  const threads = useThreads()
  const contacts = useContacts()
  const channels = useChannels()

  if (threads.isLoading) {
    return (
      <div className="space-y-2 p-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-xl" />
        ))}
      </div>
    )
  }

  if (threads.isError) {
    return (
      <div className="p-4 text-sm text-destructive">
        Failed to load threads:{" "}
        {threads.error instanceof Error ? threads.error.message : "unknown error"}
      </div>
    )
  }

  const items = threads.data ?? []
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 p-10 text-center text-sm text-muted-foreground">
        <MessagesSquare className="h-8 w-8 opacity-50" />
        <p>No conversations yet. Pick a contact from Contacts to start.</p>
      </div>
    )
  }

  return (
    <ul className="space-y-2 p-4">
      {items.map((t) => {
        let title: string
        let href: string
        if (t.msg_type === "dm") {
          const pk = t.contact_pub_key ?? ""
          const match = pk
            ? Object.values(contacts.data ?? {}).find((c) =>
                c.public_key?.toLowerCase().startsWith(pk.toLowerCase()),
              )
            : undefined
          title = match?.adv_name ?? (pk ? pk.slice(0, 12) : "Unknown contact")
          href = `/chat/${pk}`
        } else {
          const idx = t.channel_idx ?? -1
          const ch = channels.data?.find((c) => c.channel_idx === idx)
          title = ch?.channel_name ? `# ${ch.channel_name}` : `Channel #${idx}`
          href = `/channel/${idx}`
        }
        return (
          <li key={`${t.msg_type}:${t.contact_pub_key ?? ""}:${t.channel_idx ?? ""}`}>
            <ThreadRow thread={t} title={title} href={href} />
          </li>
        )
      })}
    </ul>
  )
}
