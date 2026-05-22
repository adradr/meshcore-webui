import { useCallback, useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { ConversationHeader } from "@/features/chat/ConversationHeader"
import { MessageList } from "@/features/chat/MessageList"
import { MessageInput } from "@/features/chat/MessageInput"
import { ThreadsList } from "@/features/chat/ThreadsList"
import { useMarkRead } from "@/features/chat/queries"
import { useRealtime } from "@/realtime/WebSocketProvider"

interface IncomingMatch {
  contactPubKey?: string
  channelIdx?: number
}

/**
 * Decide whether the latest WS message belongs to the currently-viewed
 * conversation and, if so, what mark-read arg to send.
 */
function matchIncoming(
  lastMessage: unknown,
  pubKey: string | undefined,
  channelIdx: number | undefined,
): IncomingMatch | null {
  if (!lastMessage || typeof lastMessage !== "object") return null
  const m = lastMessage as { type?: string; payload?: Record<string, unknown> }
  if (m.type === "contact_message" && pubKey) {
    const prefix = m.payload?.pubkey_prefix
    if (typeof prefix === "string" && pubKey.toLowerCase().startsWith(prefix.toLowerCase())) {
      return { contactPubKey: pubKey }
    }
  }
  if (m.type === "channel_message" && channelIdx !== undefined) {
    if (m.payload?.channel_idx === channelIdx) {
      return { channelIdx }
    }
  }
  return null
}

export function ChatPage() {
  const { pubKey, idx } = useParams()
  const channelIdx = idx ? parseInt(idx, 10) : undefined
  const markRead = useMarkRead()
  const { lastMessage } = useRealtime()

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
  useEffect(() => {
    const match = matchIncoming(lastMessage, pubKey, channelIdx)
    if (!match) return
    markRead.mutate(match)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastMessage, pubKey, channelIdx])

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
