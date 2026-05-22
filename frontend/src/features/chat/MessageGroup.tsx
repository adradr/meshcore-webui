import { useMemo } from "react"
import { Link } from "react-router-dom"
import { ContactAvatar } from "@/components/contact-avatar"
import { MessageBubble } from "./MessageBubble"
import type { EnrichedMessage } from "./MessageList"
import type { ResolvedSender } from "./MessageActions"

interface GroupShape {
  senderId: string | null
  isOut: boolean
  messages: EnrichedMessage[]
  isLastOutgoing: boolean
}

interface Props {
  group: GroupShape
  showSender: boolean
  contacts: Record<string, { public_key?: string; adv_name?: string }> | undefined
  /** Channel-only: forwarded to each MessageBubble for swipe-to-reply. */
  onReply?: (senderName: string) => void
}

/**
 * For DMs, resolve sender from `pubkey_prefix` / `contact_pub_key` against
 * the contacts map. Channel messages use the parsed `_parsedSender` carried
 * on each enriched message — see channelSender.ts for the rationale.
 *
 * Returns null when we can't recover a full public_key — callers fall back
 * to the plain name string and a hash-derived avatar color.
 */
function resolveDmSender(
  prefix: string | null | undefined,
  contacts: Props["contacts"],
): ResolvedSender | null {
  if (!prefix || !contacts) return null
  const lower = prefix.toLowerCase()
  for (const c of Object.values(contacts)) {
    if (
      c.public_key &&
      c.adv_name &&
      c.public_key.toLowerCase().startsWith(lower)
    ) {
      return { adv_name: c.adv_name, public_key: c.public_key }
    }
  }
  return null
}

/**
 * A run of consecutive bubbles from the same sender, sharing one avatar,
 * one sender label (channels only) and one timestamp at the bottom.
 *
 * Outgoing groups are flipped right-aligned with no avatar column.
 * Incoming channel groups show the sender name above the first bubble.
 */
export function MessageGroup({ group, showSender, contacts, onReply }: Props) {
  const first = group.messages[0]
  const last = group.messages[group.messages.length - 1]
  const parsed = first._parsedSender ?? null
  const isChannelGroup = showSender

  // Channel groups derive sender from the parsed "Name: " prefix.
  // DM groups still resolve via pubkey_prefix → contacts.
  const dmSenderPrefix = isChannelGroup
    ? null
    : (first.pubkey_prefix ?? first.contact_pub_key ?? null)
  const resolved = useMemo<ResolvedSender | null>(() => {
    if (isChannelGroup) {
      if (parsed?.publicKey && parsed.name) {
        return { adv_name: parsed.name, public_key: parsed.publicKey }
      }
      return null
    }
    return resolveDmSender(dmSenderPrefix, contacts)
  }, [isChannelGroup, parsed, dmSenderPrefix, contacts])

  const senderName = isChannelGroup
    ? (parsed?.name ?? "Unknown")
    : (resolved?.adv_name ?? dmSenderPrefix ?? "Unknown")
  const avatarSeed = isChannelGroup
    ? (parsed?.publicKey ?? parsed?.name ?? "?")
    : (dmSenderPrefix ?? "?")
  const showAvatarColumn = showSender && !group.isOut
  const timeText = new Date(last.timestamp).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  })

  return (
    <div className={`mt-3 flex gap-2 ${group.isOut ? "flex-row-reverse" : ""}`}>
      {showAvatarColumn && (
        <div className="flex-shrink-0 self-end">
          <Link
            to={
              resolved
                ? `/contact/${resolved.public_key}`
                : `/contacts?q=${encodeURIComponent(senderName)}`
            }
            aria-label={
              resolved ? `Open ${resolved.adv_name} profile` : `Find ${senderName} in contacts`
            }
          >
            <ContactAvatar
              pubkey={resolved?.public_key ?? avatarSeed}
              name={resolved?.adv_name ?? senderName}
              size="sm"
            />
          </Link>
        </div>
      )}
      <div
        className={`flex max-w-[min(80%,42rem)] flex-col gap-0.5 ${
          group.isOut ? "items-end" : "items-start"
        }`}
      >
        {showSender && !group.isOut && (
          <span className="px-2 text-[11px] font-medium text-muted-foreground">
            <Link
              to={
                resolved
                  ? `/contact/${resolved.public_key}`
                  : `/contacts?q=${encodeURIComponent(senderName)}`
              }
              className="hover:underline"
            >
              {senderName}
            </Link>
          </span>
        )}
        {group.messages.map((m, i) => {
          const isFirstInGroup = i === 0
          const isLastInGroup = i === group.messages.length - 1
          // For channel msgs, render the stripped body (no "Name: " prefix).
          const displayText =
            isChannelGroup && m._parsedSender ? m._parsedSender.body : undefined
          return (
            <MessageBubble
              key={m.id}
              message={m}
              isFirstInGroup={isFirstInGroup}
              isLastInGroup={isLastInGroup}
              showStatus={group.isOut && isLastInGroup && group.isLastOutgoing}
              resolvedSender={resolved}
              senderPrefix={dmSenderPrefix}
              displayText={displayText}
              onReply={onReply}
            />
          )
        })}
        <span
          className={`px-2 text-[10px] tabular-nums text-muted-foreground ${
            group.isOut ? "self-end" : "self-start"
          }`}
        >
          {timeText}
        </span>
      </div>
    </div>
  )
}
