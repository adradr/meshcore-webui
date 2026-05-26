import { useMemo } from "react"
import { Link } from "react-router-dom"
import { ArrowUpRight, CheckCheck, Loader2, MessagesSquare, Star, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { notifyError } from "@/lib/notify"
import { ContactAvatar } from "@/components/contact-avatar"
import { ChannelAvatar } from "@/components/channel-avatar"
import { useContacts, type Contact } from "@/features/contacts/queries"
import { useChannels } from "@/features/channels/queries"
import { useDeleteConversation, useMarkAllRead, useThreads, useUnreadTotal, type Thread } from "./queries"

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
  pubkey: string | null
  isStarred: boolean
  isFailed: boolean
}

function ThreadRow({ thread, title, href, pubkey, isStarred, isFailed }: ThreadRowProps) {
  const isChannel = thread.msg_type === "chan"
  const unread = thread.unread_count > 0
  const showDirIcon = thread.last_direction === "out"
  const del = useDeleteConversation()

  const onDelete = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!window.confirm(`Delete all messages in "${title}"?`)) return
    del.mutate(
      isChannel
        ? { channelIdx: thread.channel_idx ?? undefined }
        : { contactPubKey: thread.contact_pub_key ?? undefined },
      {
        onSuccess: (r) =>
          toast.success(`Deleted ${r.deleted} message${r.deleted === 1 ? "" : "s"}`),
        onError: (err) => notifyError("Delete conversation", err),
      },
    )
  }

  return (
    <Link to={href} className="block focus:outline-none">
      <Card size="sm" className="transition-colors hover:bg-muted/50">
        <CardContent className="flex items-center gap-3">
          {isChannel ? (
            <ChannelAvatar
              idx={thread.channel_idx ?? -1}
              name={title.replace(/^#\s*/, "")}
              size="default"
            />
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
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
            onClick={onDelete}
            disabled={del.isPending}
            aria-label="Delete conversation"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
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

function ThreadsHeader() {
  const markAll = useMarkAllRead()
  const unread = useUnreadTotal()
  const hasUnread = (unread.data?.total ?? 0) > 0
  return (
    <div className="flex items-center justify-between gap-2 px-4 pt-4">
      <h2 className="text-sm font-semibold text-muted-foreground">Conversations</h2>
      <Button
        size="sm"
        variant="ghost"
        disabled={!hasUnread || markAll.isPending}
        onClick={() => {
          markAll.mutate(undefined, {
            onSuccess: (r) =>
              toast.success(
                `Marked ${r.marked_read} conversation${
                  r.marked_read === 1 ? "" : "s"
                } as read`,
              ),
            onError: (e) => notifyError("Mark all read", e),
          })
        }}
        title="Mark all conversations as read"
        aria-label="Read all"
      >
        {markAll.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <CheckCheck className="h-4 w-4" />
        )}
        <span className="ml-1.5 hidden sm:inline">Read all</span>
      </Button>
    </div>
  )
}

export function ThreadsList() {
  const threads = useThreads()
  const contacts = useContacts()
  const channels = useChannels()

  const items = useMemo<EnrichedThread[]>(() => {
    const raw = threads.data ?? []
    // DM threads always pass; channel threads are kept iff the channel is
    // currently configured on the device. While the channels query is
    // still loading (`data === undefined`) we HIDE channel threads —
    // the prior optimism (show them all, then collapse to the
    // configured ones) produced a visible flash on every page load.
    // useChannels has a 60s staleTime and is fetched as part of the
    // chat sidebar, so the brief hide is imperceptible. A loaded-
    // but-empty array IS truthy, so if the radio reports zero
    // channels every channel thread is correctly dropped.
    const knownChannelIdxs: Set<number> | null = channels.data
      ? new Set(channels.data.map((c) => c.channel_idx))
      : null
    const enriched: EnrichedThread[] = raw
      .filter((t) => {
        if (t.msg_type !== "chan") return true
        if (knownChannelIdxs === null) return false
        const idx = t.channel_idx ?? -1
        return knownChannelIdxs.has(idx)
      })
      .map((t) => {
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
        const title = ch?.channel_name
          ? ch.channel_name
          : `Channel ${idx}`
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
      <div>
        <ThreadsHeader />
        <div className="space-y-2 p-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  if (threads.isError) {
    return (
      <div>
        <ThreadsHeader />
        <div className="p-4 text-sm text-destructive">
          Failed to load threads:{" "}
          {threads.error instanceof Error ? threads.error.message : "unknown error"}
        </div>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div>
        <ThreadsHeader />
        <div className="flex flex-col items-center justify-center gap-3 p-10 text-center text-sm text-muted-foreground">
          <MessagesSquare className="h-8 w-8 opacity-50" />
          <p>No conversations yet. Pick a contact from Contacts to start.</p>
        </div>
      </div>
    )
  }

  return (
    <div>
      <ThreadsHeader />
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
    </div>
  )
}
