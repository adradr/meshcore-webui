import { useEffect, useMemo, useRef, useState } from "react"
import { Textarea } from "@/components/ui/textarea"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

export interface MentionContact {
  adv_name: string
  public_key: string
}

interface Props {
  value: string
  onChange: (v: string) => void
  contacts: MentionContact[]
  onSubmit?: () => void
  placeholder?: string
  disabled?: boolean
}

const MIN_ROWS = 1
const MAX_ROWS = 5
const LINE_PX = 20

function resize(el: HTMLTextAreaElement) {
  el.style.height = "auto"
  const max = MAX_ROWS * LINE_PX + 16 // + py-2
  el.style.height = Math.min(el.scrollHeight, max) + "px"
}

/**
 * Auto-growing textarea with @-mention autocomplete.
 *
 * Mirrors MentionInput's popover logic over a multiline Textarea:
 * - Detects `@` token preceded by whitespace (or at start) before the caret.
 * - Renders up to 8 filtered contacts.
 * - Arrow Up/Down navigate, Enter/Tab insert mention while popover open.
 * - Bare Enter (no mention popover) submits; Shift+Enter inserts newline.
 * - Height grows up to MAX_ROWS, then scrolls internally.
 */
export function MentionTextarea({
  value,
  onChange,
  contacts,
  onSubmit,
  placeholder,
  disabled,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [tokenStart, setTokenStart] = useState<number | null>(null)
  const [selected, setSelected] = useState(0)

  useEffect(() => {
    if (ref.current) resize(ref.current)
  }, [value])

  const filtered = useMemo(() => {
    if (!query) return contacts.slice(0, 8)
    const q = query.toLowerCase()
    return contacts
      .filter((c) => c.adv_name.toLowerCase().includes(q))
      .slice(0, 8)
  }, [contacts, query])

  const updateMention = (text: string, caret: number) => {
    let i = caret - 1
    let start = -1
    while (i >= 0) {
      const ch = text[i]
      if (ch === "@") {
        if (i === 0 || /\s/.test(text[i - 1])) start = i
        break
      }
      if (/\s/.test(ch)) break
      i--
    }
    if (start < 0) {
      setOpen(false)
      setTokenStart(null)
      return
    }
    setTokenStart(start)
    setQuery(text.slice(start + 1, caret))
    setOpen(true)
    setSelected(0)
  }

  const onText = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value)
    requestAnimationFrame(() => {
      const el = ref.current
      if (el) {
        resize(el)
        updateMention(el.value, el.selectionStart ?? el.value.length)
      }
    })
  }

  const insertMention = (c: MentionContact) => {
    if (tokenStart == null || !ref.current) return
    const el = ref.current
    const caret = el.selectionStart ?? value.length
    const before = value.slice(0, tokenStart)
    const after = value.slice(caret)
    const mention = `@${c.adv_name} `
    const next = before + mention + after
    onChange(next)
    setOpen(false)
    setTokenStart(null)
    setQuery("")
    requestAnimationFrame(() => {
      const pos = (before + mention).length
      el.setSelectionRange(pos, pos)
      el.focus()
      resize(el)
    })
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (open && filtered.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setSelected((i) => (i + 1) % filtered.length)
        return
      }
      if (e.key === "ArrowUp") {
        e.preventDefault()
        setSelected((i) => (i - 1 + filtered.length) % filtered.length)
        return
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault()
        insertMention(filtered[selected])
        return
      }
      if (e.key === "Escape") {
        e.preventDefault()
        setOpen(false)
        return
      }
    }
    // Submit on bare Enter; Shift+Enter inserts newline naturally.
    if (e.key === "Enter" && !e.shiftKey && !open) {
      e.preventDefault()
      onSubmit?.()
    }
  }

  return (
    <Popover open={open && filtered.length > 0} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Textarea
          ref={ref}
          value={value}
          onChange={onText}
          onKeyDown={onKeyDown}
          rows={MIN_ROWS}
          placeholder={placeholder}
          disabled={disabled}
          className="min-h-9 resize-none text-sm leading-5"
          autoComplete="off"
          enterKeyHint="send"
        />
      </PopoverTrigger>
      <PopoverContent
        // `side="top"` keeps the suggestion list above the input — important on
        // mobile, where the bottom half of the viewport is occluded by the
        // keyboard the moment the textarea gets focus.
        side="top"
        align="start"
        sideOffset={4}
        className="w-72 max-w-[calc(100vw-2rem)] p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <Command shouldFilter={false}>
          <CommandList>
            <CommandEmpty>No contacts match</CommandEmpty>
            <CommandGroup>
              {filtered.map((c, idx) => (
                <CommandItem
                  key={c.public_key}
                  value={c.adv_name}
                  onSelect={() => insertMention(c)}
                  className={selected === idx ? "bg-accent" : ""}
                >
                  @{c.adv_name}
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    {c.public_key.slice(0, 8)}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
