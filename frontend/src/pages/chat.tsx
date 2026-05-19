import { useParams } from "react-router-dom"
import { MessageList } from "@/features/chat/MessageList"
import { MessageInput } from "@/features/chat/MessageInput"
import { ThreadsList } from "@/features/chat/ThreadsList"

export function ChatPage() {
  const { pubKey, idx } = useParams()
  const channelIdx = idx ? parseInt(idx, 10) : undefined

  if (!pubKey && channelIdx === undefined) {
    return (
      <div className="h-full overflow-y-auto">
        <ThreadsList />
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
