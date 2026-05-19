import { useMemo } from "react"
import { Link } from "react-router-dom"
import { ContactAvatar } from "@/components/contact-avatar"
import { MessageBubble } from "./MessageBubble"
import type { Message } from "./queries"
import type { ResolvedSender } from "./MessageActions"

interface GroupShape {
  senderId: string | null
  isOut: boolean
  messages: Message[]
  isLastOutgoing: boolean
}

interface Props {
  group: GroupShape
  showSender: boolean
  contacts: Record<string, { public_key?: string; adv_name?: string }> | undefined
}

/**
 * Match a channel message's `pubkey_prefix` (8-char) against the full
 * contacts map to recover the sender's display name + full public key.
 *
 * Returns null when we have no prefix or no matching contact — callers
 * fall back to the raw prefix string.
 */
function resolveSender(
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
export function MessageGroup({ group, showSender, contacts }: Props) {
  const first = group.messages[0]
  const last = group.messages[group.messages.length - 1]
  const senderPrefix = first.pubkey_prefix ?? first.contact_pub_key ?? null
  const resolved = useMemo(
    () => resolveSender(senderPrefix, contacts),
    [senderPrefix, contacts],
  )
  const senderName = resolved?.adv_name ?? senderPrefix ?? "Unknown"
  const showAvatarColumn = showSender && !group.isOut
  const timeText = new Date(last.timestamp).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  })

  return (
    <div className={`mt-3 flex gap-2 ${group.isOut ? "flex-row-reverse" : ""}`}>
      {showAvatarColumn && (
        <div className="flex-shrink-0 self-end">
          {resolved ? (
            <Link to={`/contact/${resolved.public_key}`}>
              <ContactAvatar
                pubkey={resolved.public_key}
                name={resolved.adv_name}
                size="sm"
              />
            </Link>
          ) : (
            <ContactAvatar pubkey={senderPrefix ?? "?"} name={senderName} size="sm" />
          )}
        </div>
      )}
      <div
        className={`flex max-w-[min(80%,42rem)] flex-col gap-0.5 ${
          group.isOut ? "items-end" : "items-start"
        }`}
      >
        {showSender && !group.isOut && (
          <span className="px-2 text-[11px] font-medium text-muted-foreground">
            {resolved ? (
              <Link to={`/contact/${resolved.public_key}`} className="hover:underline">
                {senderName}
              </Link>
            ) : (
              senderName
            )}
          </span>
        )}
        {group.messages.map((m, i) => {
          const isFirstInGroup = i === 0
          const isLastInGroup = i === group.messages.length - 1
          return (
            <MessageBubble
              key={m.id}
              message={m}
              isFirstInGroup={isFirstInGroup}
              isLastInGroup={isLastInGroup}
              showStatus={group.isOut && isLastInGroup && group.isLastOutgoing}
              resolvedSender={resolved}
              senderPrefix={senderPrefix}
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
