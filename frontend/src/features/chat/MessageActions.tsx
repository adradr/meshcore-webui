import { Copy, Info, MessageCircle, Radio, Send, Trash2, User } from "lucide-react"
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

export interface ResolvedSender {
  adv_name: string
  public_key: string
}

interface UseMessageActionsArgs {
  message: Message
  onShowHeardRepeats: () => void
  onShowDetails?: () => void
  resolvedSender?: ResolvedSender | null
  onMessageSender?: (publicKey: string) => void
  onViewSenderProfile?: (publicKey: string) => void
}

export function useMessageActions({
  message,
  onShowHeardRepeats,
  onShowDetails,
  resolvedSender,
  onMessageSender,
  onViewSenderProfile,
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
  if (message.direction === "in" && resolvedSender && onMessageSender) {
    items.push({
      key: "message-sender",
      label: `Message ${resolvedSender.adv_name}`,
      icon: <MessageCircle className="mr-2 h-4 w-4" />,
      onSelect: () => onMessageSender(resolvedSender.public_key),
    })
  }
  if (
    message.direction === "in" &&
    resolvedSender &&
    onViewSenderProfile
  ) {
    items.push({
      key: "view-sender-profile",
      label: "View profile",
      icon: <User className="mr-2 h-4 w-4" />,
      onSelect: () => onViewSenderProfile(resolvedSender.public_key),
    })
  }
  if (message.direction === "out") {
    items.push({
      key: "send-again",
      label: "Send again",
      icon: <Send className="mr-2 h-4 w-4" />,
      onSelect: handleSendAgain,
    })
  }
  if (onShowDetails) {
    items.push({
      key: "details",
      label: "Show details",
      icon: <Info className="mr-2 h-4 w-4" />,
      onSelect: onShowDetails,
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
