import { useMessages, type Message } from "./queries"
import { MessageBubble } from "./MessageBubble"
import { Skeleton } from "@/components/ui/skeleton"

interface Props {
  contactPubKey?: string
  channelIdx?: number
}

export function MessageList({ contactPubKey, channelIdx }: Props) {
  const q = useMessages(contactPubKey, channelIdx)

  if (q.isLoading) {
    return (
      <div className="space-y-2 p-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-3/4 rounded-lg" />
        ))}
      </div>
    )
  }

  if (q.isError) {
    return (
      <div className="p-4 text-sm text-destructive">
        Failed to load messages: {q.error instanceof Error ? q.error.message : "unknown error"}
      </div>
    )
  }

  const items = (q.data?.pages.flatMap((p) => p.items) ?? []).slice().reverse() as Message[]

  if (items.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">
        No messages yet
      </div>
    )
  }

  const showSender = channelIdx !== undefined

  return (
    <ul className="space-y-2 p-4">
      {items.map((m) => (
        <MessageBubble key={m.id} message={m} showSender={showSender} />
      ))}
    </ul>
  )
}
