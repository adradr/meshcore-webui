import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { useSendMessage } from "./useSendMessage"
import { useContacts, useContact } from "@/features/contacts/queries"
import { useChannels } from "@/features/channels/queries"
import { MentionTextarea, type MentionContact } from "./MentionTextarea"
import { Send } from "lucide-react"

interface Props {
  contactPubKey?: string
  channelIdx?: number
}

// MeshCore packet payload limits — soft warning > 140 chars, hard at >200.
const SOFT_LIMIT = 140
const HARD_LIMIT = 200

export function MessageInput({ contactPubKey, channelIdx }: Props) {
  const [text, setText] = useState("")
  const { mutate, isPending } = useSendMessage()
  const { data: contactsMap } = useContacts()
  const { contact } = useContact(contactPubKey)
  const { data: channels } = useChannels()

  const contacts = useMemo<MentionContact[]>(() => {
    if (!contactsMap) return []
    return Object.values(contactsMap)
      .filter((c) => c.adv_name && c.public_key)
      .map((c) => ({ adv_name: c.adv_name!, public_key: c.public_key! }))
  }, [contactsMap])

  const channelName = channels?.find((c) => c.channel_idx === channelIdx)?.channel_name

  const placeholder = contact?.adv_name
    ? `Message ${contact.adv_name}…`
    : channelName
      ? `Message #${channelName}…`
      : channelIdx !== undefined
        ? `Message channel ${channelIdx}…`
        : "Message…"

  const len = text.length
  const overSoft = len > SOFT_LIMIT
  const overHard = len > HARD_LIMIT

  const submit = () => {
    if (!text.trim()) return
    mutate(
      { contactPubKey, channelIdx, text },
      { onSuccess: () => setText("") },
    )
  }

  return (
    <div className="border-t bg-background/95 backdrop-blur">
      <form
        className="mx-auto flex max-w-3xl items-end gap-2 px-3 py-2"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <div className="flex flex-1 flex-col">
          <MentionTextarea
            value={text}
            onChange={setText}
            contacts={contacts}
            onSubmit={submit}
            placeholder={placeholder}
            disabled={isPending}
          />
          {overSoft && (
            <div
              className={`mt-1 self-end text-[10px] tabular-nums ${
                overHard ? "text-destructive" : "text-amber-600 dark:text-amber-500"
              }`}
            >
              {len}/{SOFT_LIMIT}
              {overHard && " — message may be split into multiple packets"}
            </div>
          )}
        </div>
        <Button
          type="submit"
          disabled={isPending || !text.trim()}
          size="icon"
          className="h-9 w-9 shrink-0 transition-transform active:scale-95"
          aria-label="Send"
        >
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  )
}
