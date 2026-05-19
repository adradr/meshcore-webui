import { Copy, Radio, Send, Trash2 } from "lucide-react"
import { toast } from "sonner"
import type { Message } from "./queries"
import { useDeleteMessage } from "./queries"
import { useSendMessage } from "./useSendMessage"

interface ItemSpec {
  key: string
  label: string
  icon: React.ReactNode
  destructive?: boolean
  onSelect: () => void
}

interface UseMessageActionsArgs {
  message: Message
  onShowHeardRepeats: () => void
}

export function useMessageActions({
  message,
  onShowHeardRepeats,
}: UseMessageActionsArgs): ItemSpec[] {
  const sendMutation = useSendMessage()
  const deleteMutation = useDeleteMessage()

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.text)
      toast.success("Copied")
    } catch {
      toast.error("Copy failed")
    }
  }

  const handleSendAgain = () => {
    sendMutation.mutate({
      contactPubKey: message.contact_pub_key ?? undefined,
      channelIdx: message.channel_idx ?? undefined,
      text: message.text,
    })
  }

  const handleDelete = () => {
    deleteMutation.mutate(message.id)
  }

  const items: ItemSpec[] = [
    {
      key: "copy",
      label: "Copy text",
      icon: <Copy className="mr-2 h-4 w-4" />,
      onSelect: handleCopy,
    },
  ]
  if (message.direction === "out") {
    items.push({
      key: "send-again",
      label: "Send again",
      icon: <Send className="mr-2 h-4 w-4" />,
      onSelect: handleSendAgain,
    })
  }
  items.push({
    key: "heard-repeats",
    label: "Heard repeats",
    icon: <Radio className="mr-2 h-4 w-4" />,
    onSelect: onShowHeardRepeats,
  })
  items.push({
    key: "delete",
    label: "Delete",
    icon: <Trash2 className="mr-2 h-4 w-4" />,
    destructive: true,
    onSelect: handleDelete,
  })
  return items
}

export type { ItemSpec as MessageActionItem }
