import { useMemo, useRef, useState } from "react"
import { MoreVertical, Reply } from "lucide-react"
import { useNavigate } from "react-router-dom"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { HeardRepeatsSheet } from "./HeardRepeatsSheet"
import { MessageDetailsSheet } from "./MessageDetailsSheet"
import {
  useMessageActions,
  type MessageActionItem,
  type ResolvedSender,
} from "./MessageActions"
import { MessageStatusIcon } from "./messageStatus"
import { useContacts } from "@/features/contacts/queries"
import type { Message } from "./queries"
import { renderMentions } from "./renderMentions"
import type { MentionContact } from "./MentionInput"
import { useSendMessage } from "./useSendMessage"
import { useAuthInfo } from "@/features/auth/api"
import { parseAttachmentUrls } from "@/features/attachments/parseAttachmentUrls"

interface Props {
  message: Message
  isFirstInGroup: boolean
  isLastInGroup: boolean
  showStatus: boolean
  resolvedSender: ResolvedSender | null
  senderPrefix: string | null
  /**
   * Override the rendered body text. Channels pass the parsed body here
   * (with the leading "Name: " stripped); DMs leave it undefined to render
   * the raw `message.text`.
   */
  displayText?: string
  /**
   * Channel-only: invoked when the user swipes the bubble right >= 50px to
   * tag the sender into the composer. Argument is the resolved adv_name.
   */
  onReply?: (senderName: string) => void
}

// Swipe-to-reply geometry — visual follow up to SWIPE_MAX, trigger at
// SWIPE_THRESHOLD on release. Hand-rolled (no gesture lib in the repo).
const SWIPE_THRESHOLD = 50
const SWIPE_MAX = 80

/**
 * Build the asymmetric rounded-corner classes for a bubble inside a
 * grouped run. The "tail" (last bubble in the group) keeps its outer
 * corner rounded large; stacked corners are squared (rounded-md) so
 * consecutive bubbles read as one cohesive cluster.
 */
function bubbleRoundingClasses(isOut: boolean, first: boolean, last: boolean): string {
  const base = "rounded-2xl"
  if (isOut) {
    // Right side: square top-right when stacked under another bubble.
    // Bottom-right is the tail when last, otherwise also squared.
    const tr = first ? "" : "rounded-tr-md"
    const br = last ? "" : "rounded-br-md"
    return `${base} ${tr} ${br}`
  }
  const tl = first ? "" : "rounded-tl-md"
  const bl = last ? "" : "rounded-bl-md"
  return `${base} ${tl} ${bl}`
}

/**
 * Single message bubble inside a MessageGroup. Owns just the bubble
 * surface + per-message action menu — the avatar / sender label /
 * timestamp live on MessageGroup so a run shares them.
 */
export function MessageBubble({
  message,
  isFirstInGroup,
  isLastInGroup,
  showStatus,
  resolvedSender,
  senderPrefix: _senderPrefix,
  displayText,
  onReply,
}: Props) {
  const [sheetOpen, setSheetOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [dx, setDx] = useState(0)
  const swipeStartXRef = useRef<number | null>(null)
  const navigate = useNavigate()
  const { data: contactsMap } = useContacts()
  const { data: authInfo } = useAuthInfo()
  const sendRetry = useSendMessage()
  const isOut = message.direction === "out"
  const isFailed = message.ack_state === "failed"
  const retryArgs = message.contact_pub_key
    ? { contactPubKey: message.contact_pub_key, text: message.text }
    : message.channel_idx != null
      ? { channelIdx: message.channel_idx, text: message.text }
      : null

  const mentionContacts = useMemo<MentionContact[]>(() => {
    if (!contactsMap) return []
    return Object.values(contactsMap)
      .filter((c) => c.adv_name && c.public_key)
      .map((c) => ({ adv_name: c.adv_name!, public_key: c.public_key! }))
  }, [contactsMap])

  const bodyText = displayText ?? message.text
  const renderedText = useMemo(
    () => renderMentions(bodyText, mentionContacts),
    [bodyText, mentionContacts],
  )

  // Inline attachment preview — only when the message body contains a
  // short URL whose host matches our configured public_base_url. The URL
  // itself is intentionally left in `bodyText` so the recipient can copy
  // / share it; the thumbnail is layered ABOVE the text render.
  const baseUrl = authInfo?.public_base_url ?? ""
  const firstAttachment = useMemo(() => {
    if (!baseUrl) return undefined
    return parseAttachmentUrls(message.text, baseUrl)[0]
  }, [baseUrl, message.text])

  const items = useMessageActions({
    message,
    onShowHeardRepeats: () => setSheetOpen(true),
    onShowDetails: () => setDetailsOpen(true),
    resolvedSender,
    onMessageSender: (pk) => navigate(`/chat/${pk}`),
    onViewSenderProfile: (pk) => navigate(`/contact/${pk}`),
  })

  const bubbleClass = `group/bubble relative px-3 py-2 ${
    isOut ? "bg-primary text-primary-foreground" : "bg-muted"
  } ${bubbleRoundingClasses(isOut, isFirstInGroup, isLastInGroup)} animate-in fade-in slide-in-from-bottom-1 duration-200`

  // Swipe-to-reply only applies to inbound channel bubbles with a resolved
  // sender; DMs, outbound bubbles and unresolved channel senders skip it.
  const swipeEnabled =
    !isOut &&
    message.channel_idx != null &&
    !!onReply &&
    !!resolvedSender
  const senderName = resolvedSender?.adv_name

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!swipeEnabled) return
    const target = e.target as HTMLElement | null
    // Don't start a swipe from interactive controls (more-actions trigger,
    // retry button, dropdown items). Buttons and elements opting out via
    // data-no-swipe are excluded.
    if (target && target.closest("button, [data-no-swipe], [role='menuitem']")) {
      return
    }
    swipeStartXRef.current = e.clientX
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // jsdom / older browsers may not support pointer capture; ignore.
    }
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (swipeStartXRef.current == null) return
    const raw = e.clientX - swipeStartXRef.current
    if (raw <= 0) {
      setDx(0)
      return
    }
    setDx(Math.min(raw, SWIPE_MAX))
  }

  const finishSwipe = (e: React.PointerEvent<HTMLDivElement>, fire: boolean) => {
    if (swipeStartXRef.current == null) return
    const finalDx = e.clientX - swipeStartXRef.current
    swipeStartXRef.current = null
    setDx(0)
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // ignore
    }
    if (fire && finalDx >= SWIPE_THRESHOLD && senderName) {
      onReply?.(senderName)
    }
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) =>
    finishSwipe(e, true)
  const handlePointerCancel = (e: React.PointerEvent<HTMLDivElement>) =>
    finishSwipe(e, false)

  const replyHintOpacity = Math.min(dx / SWIPE_THRESHOLD, 1)

  return (
    <>
      <div
        data-swipe-root
        className="relative touch-pan-y select-none"
        style={{
          transform: `translateX(${dx}px)`,
          transition: dx === 0 ? "transform 150ms ease-out" : "none",
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      >
        {swipeEnabled && dx > 0 && (
          <span
            className="pointer-events-none absolute -left-8 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full bg-muted text-muted-foreground"
            style={{ opacity: replyHintOpacity }}
            aria-hidden="true"
          >
            <Reply className="h-3.5 w-3.5" />
          </span>
        )}
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className={bubbleClass}>
            {firstAttachment && (
              <a
                href={firstAttachment.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mb-2 block"
              >
                <img
                  src={firstAttachment.thumbUrl}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  style={{
                    maxWidth: "100%",
                    maxHeight: 320,
                    aspectRatio: "4 / 3",
                    objectFit: "contain",
                  }}
                  className="rounded-md"
                />
              </a>
            )}
            <p className="break-words text-sm leading-snug">{renderedText}</p>
            {showStatus && (
              <span className="mt-0.5 flex items-center justify-end gap-1.5" title={message.ack_state}>
                {isOut && isFailed && retryArgs && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      sendRetry.mutate(retryArgs)
                    }}
                    disabled={sendRetry.isPending}
                    className="text-[10px] text-destructive underline decoration-1 underline-offset-2 hover:opacity-80 disabled:opacity-50"
                  >
                    Tap to retry
                  </button>
                )}
                <MessageStatusIcon state={message.ack_state} />
              </span>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={`absolute -top-2 ${
                    isOut ? "-left-2" : "-right-2"
                  } h-6 w-6 rounded-full bg-background/95 opacity-0 shadow-sm transition-opacity group-hover/bubble:opacity-100 focus:opacity-100`}
                  aria-label="Message actions"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreVertical className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align={isOut ? "end" : "start"} className="min-w-40">
                {items.map((it, i) => (
                  <RenderDropdownItem key={it.key} item={it} prev={items[i - 1]} />
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="min-w-40">
          {items.map((it, i) => (
            <RenderContextItem key={it.key} item={it} prev={items[i - 1]} />
          ))}
        </ContextMenuContent>
      </ContextMenu>
      </div>
      <HeardRepeatsSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        contactPubKey={message.contact_pub_key}
        messagePath={message.path}
      />
      <MessageDetailsSheet
        message={detailsOpen ? message : null}
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
      />
    </>
  )
}

function RenderDropdownItem({
  item,
  prev,
}: {
  item: MessageActionItem
  prev?: MessageActionItem
}) {
  return (
    <>
      {item.destructive && prev && !prev.destructive && <DropdownMenuSeparator />}
      <DropdownMenuItem
        onSelect={item.onSelect}
        variant={item.destructive ? "destructive" : "default"}
      >
        {item.icon}
        {item.label}
      </DropdownMenuItem>
    </>
  )
}

function RenderContextItem({
  item,
  prev,
}: {
  item: MessageActionItem
  prev?: MessageActionItem
}) {
  return (
    <>
      {item.destructive && prev && !prev.destructive && <ContextMenuSeparator />}
      <ContextMenuItem
        onSelect={item.onSelect}
        className={
          item.destructive ? "text-destructive focus:text-destructive" : undefined
        }
      >
        {item.icon}
        {item.label}
      </ContextMenuItem>
    </>
  )
}
