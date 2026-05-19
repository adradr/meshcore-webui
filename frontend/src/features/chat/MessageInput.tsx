import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { useSendMessage } from "./useSendMessage"
import { useContacts } from "@/features/contacts/queries"
import { MentionInput, type MentionContact } from "./MentionInput"
import { Send } from "lucide-react"

interface Props {
  contactPubKey?: string
  channelIdx?: number
}

export function MessageInput({ contactPubKey, channelIdx }: Props) {
  const [text, setText] = useState("")
  const { mutate, isPending } = useSendMessage()
  const { data: contactsMap } = useContacts()

  const contacts = useMemo<MentionContact[]>(() => {
    if (!contactsMap) return []
    return Object.values(contactsMap)
      .filter((c) => c.adv_name && c.public_key)
      .map((c) => ({ adv_name: c.adv_name!, public_key: c.public_key! }))
  }, [contactsMap])

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
      <MentionInput
        value={text}
        onChange={setText}
        contacts={contacts}
        inputProps={{
          placeholder: "Message…",
          enterKeyHint: "send",
          disabled: isPending,
        }}
      />
      <Button type="submit" disabled={isPending || !text.trim()} size="icon">
        <Send className="h-4 w-4" />
      </Button>
    </form>
  )
}
