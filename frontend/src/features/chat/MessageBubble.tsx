import { useMemo, useState } from "react"
import { MoreVertical } from "lucide-react"
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
}

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
}: Props) {
  const [sheetOpen, setSheetOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const navigate = useNavigate()
  const { data: contactsMap } = useContacts()
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

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className={bubbleClass}>
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
