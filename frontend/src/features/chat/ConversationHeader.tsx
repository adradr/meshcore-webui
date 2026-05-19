import { ArrowLeft, Hash, Info } from "lucide-react"
import { useNavigate, Link } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { ContactAvatar } from "@/components/contact-avatar"
import { useContact } from "@/features/contacts/queries"
import { useChannels } from "@/features/channels/queries"
import { useRealtime } from "@/realtime/WebSocketProvider"

interface Props {
  contactPubKey?: string
  channelIdx?: number
}

function relativeTime(unix?: number | null): string {
  if (!unix) return ""
  const ms = Date.now() - unix * 1000
  const m = Math.floor(ms / 60_000)
  if (m < 1) return "now"
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

/**
 * Per-conversation header shown above the message list.
 *
 * Renders one of two variants:
 * - DM: back button + avatar + contact name + "last heard" subtitle + info button
 * - Channel: back button + # icon + channel name + ws-status dot subtitle
 */
export function ConversationHeader({ contactPubKey, channelIdx }: Props) {
  const navigate = useNavigate()
  const { contact } = useContact(contactPubKey)
  const { data: channels } = useChannels()
  const { status } = useRealtime()
  const isWsOpen = status === "open"

  if (contactPubKey && contact) {
    const name = contact.adv_name ?? contactPubKey.slice(0, 8)
    return (
      <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-background/95 px-2 backdrop-blur">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <Link
          to={`/contact/${contactPubKey}`}
          className="flex flex-1 items-center gap-2 min-w-0"
        >
          <ContactAvatar pubkey={contactPubKey} name={name} size="sm" />
          <div className="min-w-0 flex-1 text-left">
            <p className="truncate text-sm font-semibold leading-tight">{name}</p>
            {contact.last_advert ? (
              <p className="truncate text-[10px] text-muted-foreground leading-tight">
                last heard {relativeTime(contact.last_advert)}
              </p>
            ) : null}
          </div>
        </Link>
        <Button variant="ghost" size="icon" asChild aria-label="Contact info">
          <Link to={`/contact/${contactPubKey}`}>
            <Info className="h-4 w-4" />
          </Link>
        </Button>
      </header>
    )
  }

  if (channelIdx !== undefined) {
    const ch = channels?.find((c) => c.channel_idx === channelIdx)
    const name = ch?.channel_name ?? `Channel ${channelIdx}`
    return (
      <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-background/95 px-2 backdrop-blur">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Hash className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold leading-tight">{name}</p>
          <p className="truncate text-[10px] text-muted-foreground leading-tight flex items-center gap-1">
            <span
              className={`h-1.5 w-1.5 rounded-full ${isWsOpen ? "bg-green-500" : "bg-muted-foreground"}`}
            />
            broadcast channel
          </p>
        </div>
      </header>
    )
  }

  return null
}
