import { useCallback, useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { ConversationHeader } from "@/features/chat/ConversationHeader"
import { MessageList } from "@/features/chat/MessageList"
import { MessageInput } from "@/features/chat/MessageInput"
import { ThreadsList } from "@/features/chat/ThreadsList"
import { useMarkRead } from "@/features/chat/queries"
import { useWsTopic } from "@/realtime/useWsTopic"

interface IncomingMatch {
  contactPubKey?: string
  channelIdx?: number
}

/**
 * Decide whether an incoming `messages`-topic payload belongs to the
 * currently-viewed conversation and, if so, what mark-read arg to send.
 *
 * The topic carries several event payloads (contact/channel messages, acks,
 * advertisements, …) without a type discriminator, so the shape itself
 * disambiguates: only actual messages carry `text`, channel messages carry
 * `channel_idx`, and DMs carry `pubkey` (full, enriched server-side) and/or
 * the legacy short `pubkey_prefix`.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function matchIncoming(
  payload: unknown,
  pubKey: string | undefined,
  channelIdx: number | undefined,
): IncomingMatch | null {
  if (!payload || typeof payload !== "object") return null
  const p = payload as Record<string, unknown>
  if (typeof p.text !== "string") return null // acks / adverts / path updates
  if (typeof p.channel_idx === "number") {
    return channelIdx !== undefined && p.channel_idx === channelIdx
      ? { channelIdx }
      : null
  }
  if (!pubKey) return null
  // When the backend resolved the full pubkey, it is authoritative — a
  // prefix collision must not mark a different conversation as read.
  const full = typeof p.pubkey === "string" ? p.pubkey : undefined
  if (full) {
    return full.toLowerCase() === pubKey.toLowerCase()
      ? { contactPubKey: pubKey }
      : null
  }
  const prefix = p.pubkey_prefix
  if (
    typeof prefix === "string" &&
    prefix.length > 0 &&
    pubKey.toLowerCase().startsWith(prefix.toLowerCase())
  ) {
    return { contactPubKey: pubKey }
  }
  return null
}

export function ChatPage() {
  const { pubKey, idx } = useParams()
  const channelIdx = idx ? parseInt(idx, 10) : undefined
  const markRead = useMarkRead()

  // Composer draft is lifted so swipe-to-reply on a channel bubble can
  // prefill `@SenderName ` and bump `seedKey` to refocus the textarea.
  const [draft, setDraft] = useState("")
  const [seedKey, setSeedKey] = useState(0)
  const handleReply = useCallback((senderName: string) => {
    setDraft((d) => (d.trim() ? `${d} @${senderName} ` : `@${senderName} `))
    setSeedKey((k) => k + 1)
  }, [])

  // Mark read on mount / when route conversation changes.
  useEffect(() => {
    if (!pubKey && channelIdx === undefined) return
    markRead.mutate({ contactPubKey: pubKey, channelIdx })
    // markRead.mutate is stable; intentionally omitted from deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pubKey, channelIdx])

  // Re-mark when a new message arrives via WS for the active conversation.
  // Topic subscription (not context lastMessage) so unrelated WS traffic
  // never re-renders this page.
  const markReadMutate = markRead.mutate
  const onIncoming = useCallback(
    (payload: unknown) => {
      const match = matchIncoming(payload, pubKey, channelIdx)
      if (match) markReadMutate(match)
    },
    [pubKey, channelIdx, markReadMutate],
  )
  useWsTopic("messages", onIncoming)

  if (!pubKey && channelIdx === undefined) {
    return (
      <div className="h-full overflow-y-auto">
        <ThreadsList />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <ConversationHeader contactPubKey={pubKey} channelIdx={channelIdx} />
      <div className="flex-1 min-h-0">
        <MessageList
          contactPubKey={pubKey}
          channelIdx={channelIdx}
          onReply={handleReply}
        />
      </div>
      <MessageInput
        contactPubKey={pubKey}
        channelIdx={channelIdx}
        value={draft}
        onChange={setDraft}
        seedKey={seedKey}
      />
    </div>
  )
}
