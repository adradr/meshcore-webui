import { useState } from "react"
import { MoreVertical } from "lucide-react"
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
import { useMessageActions, type MessageActionItem } from "./MessageActions"
import { MessageStatusBadge } from "./messageStatus"
import type { Message } from "./queries"

interface Props {
  message: Message
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

export function MessageBubble({ message }: Props) {
  const [sheetOpen, setSheetOpen] = useState(false)
  const items = useMessageActions({
    message,
    onShowHeardRepeats: () => setSheetOpen(true),
  })

  const isOut = message.direction === "out"
  const alignmentClass = isOut
    ? "ml-auto bg-primary text-primary-foreground"
    : "bg-muted"

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <li
            className={`group/bubble relative max-w-[80%] rounded-lg px-3 py-2 pr-7 ${alignmentClass}`}
          >
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
