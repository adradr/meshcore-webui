import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { ChevronUp } from "lucide-react"
import { useMessages, type Message } from "./queries"
import { MessageGroup } from "./MessageGroup"
import { DateSeparator } from "./DateSeparator"
import { GapSeparator } from "./GapSeparator"
import { NewMessagesPill } from "./NewMessagesPill"
import { ChatEmpty } from "./ChatEmpty"
import { Skeleton } from "@/components/ui/skeleton"
import { useContacts } from "@/features/contacts/queries"
import { parseChannelSender, type ChannelSender } from "./channelSender"

export interface EnrichedMessage extends Message {
  /** Parsed channel sender — populated only when isChannel and parse succeeded. */
  _parsedSender?: ChannelSender | null
}

interface Props {
  contactPubKey?: string
  channelIdx?: number
  /** Channel-only: invoked when a bubble is swiped-to-reply. */
  onReply?: (senderName: string) => void
}

type GroupItem = {
  kind: "group"
  key: string
  senderId: string | null
  isOut: boolean
  messages: EnrichedMessage[]
  isLastOutgoing: boolean
}

type TimelineItem =
  | { kind: "date"; key: string; label: string }
  | { kind: "gap"; key: string; label: string }
  | GroupItem

const GROUP_GAP_MS = 60_000 // 60s: messages within this window from same sender share a group
const GAP_MARKER_MS = 60 * 60_000 // 1h: insert a gap marker between groups

function dayLabel(d: Date): string {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const yest = new Date(today)
  yest.setDate(today.getDate() - 1)
  const dd = new Date(d)
  dd.setHours(0, 0, 0, 0)
  if (dd.getTime() === today.getTime()) return "Today"
  if (dd.getTime() === yest.getTime()) return "Yesterday"
  const diffDays = (today.getTime() - dd.getTime()) / 86_400_000
  if (diffDays < 7) return d.toLocaleDateString(undefined, { weekday: "long" })
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}

function gapLabel(ms: number): string {
  const m = Math.round(ms / 60_000)
  if (m < 120) return `${m} minutes later`
  const h = Math.round(m / 3_600_000)
  if (h < 24) return `${h} hours later`
  return `${Math.round(h / 24)} days later`
}

function senderIdOf(m: EnrichedMessage, isChannel: boolean): string | null {
  if (m.direction === "out") return "self"
  if (isChannel) {
    const ps = m._parsedSender
    if (ps?.publicKey) return ps.publicKey.toLowerCase()
    if (ps?.name) return `name:${ps.name.toLowerCase()}`
    return (m.pubkey_prefix ?? m.contact_pub_key ?? "unknown").toLowerCase()
  }
  return "peer"
}

/**
 * Walks the ordered (ascending) messages and emits a flat timeline of
 * date separators, gap markers and sender-grouped message clusters.
 *
 * Rules:
 * - A new GROUP starts when the sender changes, the direction flips, or
 *   the timestamp gap from the previous message exceeds GROUP_GAP_MS.
 * - A new DATE section starts when the local date changes.
 * - A GAP marker is inserted between groups (same date) when the time
 *   gap exceeds GAP_MARKER_MS.
 * - The last outgoing GROUP is flagged so the bubble layer can show a
 *   single status icon (iMessage-style "last delivery state only").
 */
function buildTimeline(messages: EnrichedMessage[], isChannel: boolean): TimelineItem[] {
  const items: TimelineItem[] = []
  let lastDateKey = ""
  let lastTs: number | null = null
  let currentGroup: GroupItem | null = null
  let lastOutgoingIndex = -1

  for (const m of messages) {
    const date = new Date(m.timestamp)
    const ts = date.getTime()
    const dateKey = date.toISOString().slice(0, 10)

    if (dateKey !== lastDateKey) {
      items.push({ kind: "date", key: `date-${dateKey}`, label: dayLabel(date) })
      lastDateKey = dateKey
      currentGroup = null
    } else if (lastTs !== null && ts - lastTs > GAP_MARKER_MS) {
      items.push({ kind: "gap", key: `gap-${ts}`, label: gapLabel(ts - lastTs) })
      currentGroup = null
    }

    const sender = senderIdOf(m, isChannel)
    const isOut = m.direction === "out"
    const shouldStartNewGroup =
      !currentGroup ||
      currentGroup.senderId !== sender ||
      currentGroup.isOut !== isOut ||
      (lastTs !== null && ts - lastTs > GROUP_GAP_MS)

    if (shouldStartNewGroup) {
      currentGroup = {
        kind: "group",
        key: `g-${m.id}`,
        senderId: sender,
        isOut,
        messages: [m],
        isLastOutgoing: false,
      }
      items.push(currentGroup)
    } else {
      currentGroup!.messages.push(m)
    }

    if (isOut) lastOutgoingIndex = items.length - 1
    lastTs = ts
  }

  if (lastOutgoingIndex >= 0) {
    const last = items[lastOutgoingIndex]
    if (last.kind === "group") last.isLastOutgoing = true
  }
  return items
}

/**
 * Scrollable message list with grouping, date separators, infinite scroll
 * for older messages and autoscroll-to-bottom for new ones.
 *
 * The list OWNS its own scroll container — do not wrap it in another
 * `overflow-y-auto` parent or the sentinel/observer math breaks.
 */
export function MessageList({ contactPubKey, channelIdx, onReply }: Props) {
  const q = useMessages(contactPubKey, channelIdx)
  const { data: contacts } = useContacts()
  const isChannel = channelIdx !== undefined

  const scrollRef = useRef<HTMLDivElement>(null)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const prevScrollHeightRef = useRef<number>(0)
  const messageCountRef = useRef(0)

  const [newCount, setNewCount] = useState(0)
  const [showJumpToBottom, setShowJumpToBottom] = useState(false)

  const messages = useMemo(
    () => ((q.data?.pages.flatMap((p) => p.items) ?? []).slice().reverse() as Message[]),
    [q.data],
  )

  const enriched = useMemo<EnrichedMessage[]>(() => {
    if (!isChannel) return messages
    return messages.map((m) => ({
      ...m,
      _parsedSender: m.direction === "in" ? parseChannelSender(m.text, contacts) : null,
    }))
  }, [messages, contacts, isChannel])

  const timeline = useMemo(() => buildTimeline(enriched, isChannel), [enriched, isChannel])

  // Autoscroll: initial load drops us at the bottom; subsequent appends
  // only scroll if we were already near the bottom. Page-up loads restore
  // the previous scroll offset so the viewport doesn't jump.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const isInitialLoad = messageCountRef.current === 0 && messages.length > 0
    const addedCount = messages.length - messageCountRef.current
    messageCountRef.current = messages.length

    if (isInitialLoad) {
      el.scrollTop = el.scrollHeight
      return
    }
    if (addedCount > 0 && prevScrollHeightRef.current > 0) {
      const newHeight = el.scrollHeight
      el.scrollTop = newHeight - prevScrollHeightRef.current
      prevScrollHeightRef.current = 0
      return
    }
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    if (addedCount > 0 && distanceFromBottom < 200) {
      el.scrollTop = el.scrollHeight
      setNewCount(0)
    } else if (addedCount > 0) {
      setNewCount((n) => n + addedCount)
    }
  }, [messages])

  // Track scroll position for the jump-to-bottom pill.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight
      setShowJumpToBottom(distance > 400)
      if (distance < 100) setNewCount(0)
    }
    el.addEventListener("scroll", onScroll, { passive: true })
    return () => el.removeEventListener("scroll", onScroll)
  }, [])

  // IntersectionObserver on the top sentinel → fetch the next (older) page.
  useEffect(() => {
    const sentinel = loadMoreRef.current
    if (!sentinel || !q.hasNextPage || q.isFetchingNextPage) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          const el = scrollRef.current
          if (el) prevScrollHeightRef.current = el.scrollHeight
          q.fetchNextPage()
        }
      },
      { rootMargin: "200px" },
    )
    io.observe(sentinel)
    return () => io.disconnect()
  }, [q.hasNextPage, q.isFetchingNextPage, q])

  const jumpToBottom = () => {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
    setNewCount(0)
  }

  if (q.isLoading) {
    return (
      <div className="space-y-3 p-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton
            key={i}
            className={`h-10 rounded-2xl ${i % 2 === 0 ? "w-2/3" : "ml-auto w-1/2"}`}
          />
        ))}
      </div>
    )
  }
  if (q.isError) {
    return (
      <div className="p-4 text-sm text-destructive">
        Failed to load messages: {q.error instanceof Error ? q.error.message : "unknown error"}
      </div>
    )
  }
  if (messages.length === 0) {
    return <ChatEmpty contactPubKey={contactPubKey} channelIdx={channelIdx} />
  }

  return (
    <div ref={scrollRef} className="relative h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-3 py-3">
        {q.hasNextPage && (
          <div
            ref={loadMoreRef}
            className="flex justify-center py-2 text-xs text-muted-foreground"
          >
            {q.isFetchingNextPage ? (
              "Loading older messages…"
            ) : (
              <ChevronUp className="h-4 w-4 opacity-50" />
            )}
          </div>
        )}
        {timeline.map((it) => {
          if (it.kind === "date") return <DateSeparator key={it.key} label={it.label} />
          if (it.kind === "gap") return <GapSeparator key={it.key} label={it.label} />
          return (
            <MessageGroup
              key={it.key}
              group={it}
              showSender={isChannel}
              contacts={contacts}
              onReply={onReply}
            />
          )
        })}
      </div>
      {(newCount > 0 || showJumpToBottom) && (
        <NewMessagesPill count={newCount} onClick={jumpToBottom} />
      )}
    </div>
  )
}
