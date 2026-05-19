import { useMemo } from "react"
import { Link } from "react-router-dom"
import { ArrowUpRight, Hash, MessagesSquare, Star } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { ContactAvatar } from "@/components/contact-avatar"
import { useContacts, type Contact } from "@/features/contacts/queries"
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

interface ChannelAvatarProps {
  idx: number
}

function ChannelAvatar({ idx }: ChannelAvatarProps) {
  return (
    <div
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
      aria-label={`Channel ${idx}`}
    >
      <Hash className="h-5 w-5" />
    </div>
  )
}

interface ThreadRowProps {
  thread: Thread
  title: string
  href: string
  pubkey: string | null
  isStarred: boolean
  isFailed: boolean
}

function ThreadRow({ thread, title, href, pubkey, isStarred, isFailed }: ThreadRowProps) {
  const isChannel = thread.msg_type === "chan"
  const unread = thread.unread_count > 0
  const showDirIcon = thread.last_direction === "out"
  return (
    <Link to={href} className="block focus:outline-none">
      <Card size="sm" className="transition-colors hover:bg-muted/50">
        <CardContent className="flex items-center gap-3">
          {isChannel ? (
            <ChannelAvatar idx={thread.channel_idx ?? -1} />
          ) : (
            <ContactAvatar
              pubkey={pubkey ?? "?"}
              name={title}
              size="default"
            />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span
                className={`truncate ${unread ? "font-semibold" : "font-medium"}`}
              >
                {title}
              </span>
              {isStarred && (
                <Star
                  className="h-3 w-3 shrink-0 fill-amber-400 text-amber-400"
                  aria-label="Starred"
                />
              )}
              <time
                className={`ml-auto shrink-0 text-xs tabular-nums ${
                  unread ? "text-primary font-medium" : "text-muted-foreground"
                }`}
                dateTime={thread.last_timestamp ?? undefined}
              >
                {relativeTime(thread.last_timestamp)}
              </time>
            </div>
            <div
              className={`mt-0.5 flex items-center gap-1 text-xs ${
                unread ? "text-foreground" : "text-muted-foreground"
              }`}
            >
              {showDirIcon && (
                <ArrowUpRight
                  className={`h-3 w-3 shrink-0 ${
                    isFailed ? "text-destructive" : "opacity-70"
                  }`}
                  aria-label="sent"
                />
              )}
              <span className={`min-w-0 flex-1 truncate ${unread ? "font-medium" : ""}`}>
                {truncate(thread.last_text)}
              </span>
              {unread && (
                <span
                  className="ml-1 flex h-5 min-w-[1.25rem] shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold leading-none tabular-nums text-primary-foreground"
                  aria-label={`${thread.unread_count} unread`}
                >
                  {thread.unread_count > 99 ? "99+" : thread.unread_count}
                </span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}

interface EnrichedThread {
  thread: Thread
  title: string
  href: string
  pubkey: string | null
  isStarred: boolean
  isFailed: boolean
}

function findContactByPrefix(
  pk: string,
  contacts: Record<string, Contact> | undefined,
): Contact | undefined {
  if (!pk || !contacts) return undefined
  const lower = pk.toLowerCase()
  return Object.values(contacts).find((c) =>
    c.public_key?.toLowerCase().startsWith(lower),
  )
}

export function ThreadsList() {
  const threads = useThreads()
  const contacts = useContacts()
  const channels = useChannels()

  const items = useMemo<EnrichedThread[]>(() => {
    const raw = threads.data ?? []
    const enriched: EnrichedThread[] = raw.map((t) => {
      if (t.msg_type === "dm") {
        const pk = t.contact_pub_key ?? ""
        const match = findContactByPrefix(pk, contacts.data)
        const title =
          match?.adv_name ?? (pk ? pk.slice(0, 12) : "Unknown contact")
        const isStarred = ((match?.flags ?? 0) & 0x01) === 0x01
        return {
          thread: t,
          title,
          href: `/chat/${pk}`,
          pubkey: match?.public_key ?? (pk || null),
          isStarred,
          isFailed: false,
        }
      }
      const idx = t.channel_idx ?? -1
      const ch = channels.data?.find((c) => c.channel_idx === idx)
      const title = ch?.channel_name ? `# ${ch.channel_name}` : `Channel #${idx}`
      return {
        thread: t,
        title,
        href: `/channel/${idx}`,
        pubkey: null,
        isStarred: false,
        isFailed: false,
      }
    })
    enriched.sort((a, b) => {
      if (a.isStarred !== b.isStarred) return a.isStarred ? -1 : 1
      const at = a.thread.last_timestamp
        ? new Date(a.thread.last_timestamp).getTime()
        : 0
      const bt = b.thread.last_timestamp
        ? new Date(b.thread.last_timestamp).getTime()
        : 0
      return bt - at
    })
    return enriched
  }, [threads.data, contacts.data, channels.data])

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
      {items.map((it) => (
        <li
          key={`${it.thread.msg_type}:${it.thread.contact_pub_key ?? ""}:${it.thread.channel_idx ?? ""}`}
        >
          <ThreadRow
            thread={it.thread}
            title={it.title}
            href={it.href}
            pubkey={it.pubkey}
            isStarred={it.isStarred}
            isFailed={it.isFailed}
          />
        </li>
      ))}
    </ul>
  )
}
