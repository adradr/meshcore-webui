import { useState } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useSendMessage } from "./useSendMessage"
import { Send } from "lucide-react"

interface Props {
  contactPubKey?: string
  channelIdx?: number
}

export function MessageInput({ contactPubKey, channelIdx }: Props) {
  const [text, setText] = useState("")
  const { mutate, isPending } = useSendMessage()

  const submit = () => {
    if (!text.trim()) return
    mutate(
      { contactPubKey, channelIdx, text },
      { onSuccess: () => setText("") },
    )
  }

  return (
    <form
      className="flex gap-2 border-t p-2"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Message…"
        enterKeyHint="send"
        disabled={isPending}
      />
      <Button type="submit" disabled={isPending || !text.trim()} size="icon">
        <Send className="h-4 w-4" />
      </Button>
    </form>
  )
}
