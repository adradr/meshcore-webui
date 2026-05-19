import { MessageBubble } from "./MessageBubble"
import type { Message } from "./queries"

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
 * Renders a stack of consecutive bubbles from the same sender. The
 * shared avatar / sender label / timestamp live here so each individual
 * bubble can be lean. The Task 4 refactor will move those onto this
 * component; for now we delegate to the existing MessageBubble.
 */
export function MessageGroup({ group, showSender, contacts: _contacts }: Props) {
  return (
    <>
      {group.messages.map((m) => (
        <MessageBubble key={m.id} message={m} showSender={showSender} />
      ))}
    </>
  )
}
