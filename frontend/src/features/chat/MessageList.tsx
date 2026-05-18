import { useMessages } from "./queries"
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

  const items = q.data?.pages.flatMap((p) => p.items).reverse() ?? []

  if (items.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">
        No messages yet
      </div>
    )
  }

  return (
    <ul className="space-y-2 p-4">
      {items.map((m) => (
        <li
          key={m.id}
          className={`max-w-[80%] rounded-lg px-3 py-2 ${
            m.direction === "out"
              ? "ml-auto bg-primary text-primary-foreground"
              : "bg-muted"
          }`}
        >
          <p className="break-words text-sm">{m.text}</p>
          <time className="block text-[10px] opacity-60">
            {new Date(m.timestamp).toLocaleTimeString()}
          </time>
        </li>
      ))}
    </ul>
  )
}
