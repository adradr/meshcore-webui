import { MessageCircle } from "lucide-react"

interface Props {
  contactPubKey?: string
  channelIdx?: number
}

/**
 * Centered empty state shown when a conversation has no messages.
 */
export function ChatEmpty({ channelIdx }: Props) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
        <MessageCircle className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="text-sm font-semibold">No messages yet</h3>
      <p className="max-w-sm text-xs text-muted-foreground">
        {channelIdx !== undefined
          ? "Be the first to send a message to this channel."
          : "Send a message to start the conversation."}
      </p>
    </div>
  )
}
