import { useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { useSendMessage } from "./useSendMessage"
import { useContacts, useContact } from "@/features/contacts/queries"
import { useChannels } from "@/features/channels/queries"
import { MentionTextarea, type MentionContact } from "./MentionTextarea"
import { AttachmentMenu } from "./AttachmentMenu"
import { Send } from "lucide-react"

interface Props {
  contactPubKey?: string
  channelIdx?: number
  /**
   * Controlled-text mode: pass BOTH `value` and `onChange` to lift the
   * draft into the parent (used by chat.tsx to prefill `@Sender ` from a
   * swipe-to-reply). Leave both undefined to keep the legacy uncontrolled
   * behaviour where the component owns its own draft state.
   */
  value?: string
  onChange?: (v: string) => void
  /**
   * Monotonic seed counter — when it changes, the textarea receives focus.
   * Pair with a controlled `value` to prefill content before bumping.
   */
  seedKey?: number
}

// MeshCore packet payload limits — soft warning > 140 chars, hard at >200.
const SOFT_LIMIT = 140
const HARD_LIMIT = 200

export function MessageInput({
  contactPubKey,
  channelIdx,
  value,
  onChange,
  seedKey,
}: Props) {
  // Controlled when BOTH value+onChange are supplied; otherwise we keep
  // our own internal state for backwards compat with existing call-sites.
  const isControlled = value !== undefined && onChange !== undefined
  const [internalText, setInternalText] = useState("")
  const text = isControlled ? value! : internalText
  const setText = (v: string) => {
    if (isControlled) onChange!(v)
    else setInternalText(v)
  }
  const textareaHandleRef = useRef<{ focus: () => void } | null>(null)
  // seedKey bump = "focus me" — paired with a fresh `value` from the parent.
  useEffect(() => {
    if (seedKey === undefined) return
    textareaHandleRef.current?.focus()
  }, [seedKey])
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

  /** Append a snippet from the AttachmentMenu to the current draft.
   *  Non-empty drafts get a newline separator first so the inserted
   *  meshcore URI / OSM link is not glued onto the previous line. */
  const onInsert = (snippet: string) => {
    const current = text.trim()
    const next = current ? `${current}\n${snippet}` : snippet
    setText(next)
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
        <AttachmentMenu onInsert={onInsert} disabled={isPending} />
        <div className="flex flex-1 flex-col">
          <MentionTextarea
            value={text}
            onChange={setText}
            contacts={contacts}
            onSubmit={submit}
            placeholder={placeholder}
            disabled={isPending}
            textareaRef={textareaHandleRef}
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
