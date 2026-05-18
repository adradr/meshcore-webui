import { useParams } from "react-router-dom"
import { MessageList } from "@/features/chat/MessageList"
import { MessageInput } from "@/features/chat/MessageInput"

export function ChatPage() {
  const { pubKey, idx } = useParams()
  const channelIdx = idx ? parseInt(idx, 10) : undefined

  if (!pubKey && channelIdx === undefined) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-sm text-muted-foreground">
        Select a contact or channel to start chatting.
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto">
        <MessageList contactPubKey={pubKey} channelIdx={channelIdx} />
      </div>
      <MessageInput contactPubKey={pubKey} channelIdx={channelIdx} />
    </div>
  )
}
