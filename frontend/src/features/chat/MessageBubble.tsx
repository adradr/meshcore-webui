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
import {
  useMessageActions,
  type MessageActionItem,
  type ResolvedSender,
} from "./MessageActions"
import { MessageStatusBadge } from "./messageStatus"
import { useContacts } from "@/features/contacts/queries"
import type { Message } from "./queries"

interface Props {
  message: Message
  showSender?: boolean
}

function renderContextItems(items: MessageActionItem[]) {
  const out: React.ReactNode[] = []
  items.forEach((it, i) => {
    const isLast = i === items.length - 1
    const prev = items[i - 1]
    if (it.destructive && prev && !prev.destructive) {
      out.push(<ContextMenuSeparator key={`sep-${it.key}`} />)
    }
    out.push(
      <ContextMenuItem
        key={it.key}
        onSelect={it.onSelect}
        className={it.destructive ? "text-destructive focus:text-destructive" : undefined}
      >
        {it.icon}
        {it.label}
      </ContextMenuItem>,
    )
    if (isLast) return
  })
  return out
}

function renderDropdownItems(items: MessageActionItem[]) {
  const out: React.ReactNode[] = []
  items.forEach((it, i) => {
    const prev = items[i - 1]
    if (it.destructive && prev && !prev.destructive) {
      out.push(<DropdownMenuSeparator key={`sep-${it.key}`} />)
    }
    out.push(
      <DropdownMenuItem
        key={it.key}
        onSelect={it.onSelect}
        variant={it.destructive ? "destructive" : "default"}
      >
        {it.icon}
        {it.label}
      </DropdownMenuItem>,
    )
  })
  return out
}

/**
 * Resolve a message's sender prefix → a full contact for display + DM action.
 *
 * For channel messages the bridge stores the 8-char `pubkey_prefix` (when
 * available) in either the dedicated `pubkey_prefix` field or the legacy
 * `contact_pub_key` slot — try both.
 */
function useResolvedSender(message: Message): ResolvedSender | null {
  const { data: contactsMap } = useContacts()
  return useMemo(() => {
    const prefix = (message.pubkey_prefix ?? message.contact_pub_key ?? "").toLowerCase()
    if (!prefix || !contactsMap) return null
    for (const c of Object.values(contactsMap)) {
      if (
        c.public_key &&
        c.adv_name &&
        c.public_key.toLowerCase().startsWith(prefix)
      ) {
        return { adv_name: c.adv_name, public_key: c.public_key }
      }
    }
    return null
  }, [contactsMap, message.pubkey_prefix, message.contact_pub_key])
}

export function MessageBubble({ message, showSender = false }: Props) {
  const [sheetOpen, setSheetOpen] = useState(false)
  const navigate = useNavigate()
  const resolvedSender = useResolvedSender(message)

  const items = useMessageActions({
    message,
    onShowHeardRepeats: () => setSheetOpen(true),
    resolvedSender: showSender ? resolvedSender : null,
    onMessageSender: (pk) => navigate(`/chat/${pk}`),
  })

  const isOut = message.direction === "out"
  const alignmentClass = isOut
    ? "ml-auto bg-primary text-primary-foreground"
    : "bg-muted"

  // The prefix label fallback when no contact resolves.
  const senderPrefix =
    message.pubkey_prefix ?? message.contact_pub_key ?? null
  const senderLabel = resolvedSender?.adv_name ?? senderPrefix ?? null
  const senderClickable = !!resolvedSender

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <li
            className={`group/bubble relative max-w-[80%] rounded-lg px-3 py-2 pr-7 ${alignmentClass}`}
          >
            {showSender && senderLabel && (
              <button
                type="button"
                disabled={!senderClickable}
                onClick={() =>
                  resolvedSender && navigate(`/chat/${resolvedSender.public_key}`)
                }
                className={`mb-0.5 block text-[10px] text-muted-foreground ${
                  senderClickable ? "cursor-pointer hover:underline" : "cursor-default"
                }`}
              >
                {senderLabel}
              </button>
            )}
            <p className="break-words text-sm">{message.text}</p>
            <div className="mt-0.5 flex items-center gap-2">
              <time className="text-[10px] opacity-60">
                {new Date(message.timestamp).toLocaleTimeString()}
              </time>
              {isOut && <MessageStatusBadge state={message.ack_state} />}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute top-1 right-1 h-6 w-6 opacity-60 hover:opacity-100"
                  aria-label="Message actions"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreVertical className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-40">
                {renderDropdownItems(items)}
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        </ContextMenuTrigger>
        <ContextMenuContent className="min-w-40">
          {renderContextItems(items)}
        </ContextMenuContent>
      </ContextMenu>
      <HeardRepeatsSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        contactPubKey={message.contact_pub_key}
      />
    </>
  )
}
