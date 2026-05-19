import { useMemo, useRef, useState } from "react"
import { Input } from "@/components/ui/input"
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
  inputProps?: Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">
}

/**
 * Text input with @-mention autocomplete via a Command popover.
 *
 * - Detects an `@` token preceded by whitespace (or at start) before the caret.
 * - Renders up to 8 filtered contacts by case-insensitive substring match.
 * - Arrow Up/Down navigate, Enter/Tab insert, Esc closes.
 * - Inserts `@<adv_name> ` and restores caret at end of inserted text.
 */
export function MentionInput({ value, onChange, contacts, inputProps }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [tokenStart, setTokenStart] = useState<number | null>(null)
  const [selectedIdx, setSelectedIdx] = useState(0)

  const filtered = useMemo(() => {
    if (!query) return contacts.slice(0, 8)
    const q = query.toLowerCase()
    return contacts
      .filter((c) => c.adv_name.toLowerCase().includes(q))
      .slice(0, 8)
  }, [contacts, query])

  const updateMentionState = (text: string, caret: number) => {
    let i = caret - 1
    let tokenStartAt = -1
    while (i >= 0) {
      const ch = text[i]
      if (ch === "@") {
        if (i === 0 || /\s/.test(text[i - 1])) {
          tokenStartAt = i
        }
        break
      }
      if (/\s/.test(ch)) break
      i--
    }
    if (tokenStartAt < 0) {
      setOpen(false)
      setTokenStart(null)
      return
    }
    setTokenStart(tokenStartAt)
    setQuery(text.slice(tokenStartAt + 1, caret))
    setOpen(true)
    setSelectedIdx(0)
  }

  const onTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value
    onChange(next)
    requestAnimationFrame(() => {
      const el = inputRef.current
      if (!el) return
      updateMentionState(next, el.selectionStart ?? next.length)
    })
  }

  const insertMention = (contact: MentionContact) => {
    if (tokenStart == null) return
    const before = value.slice(0, tokenStart)
    const caretEl = inputRef.current
    const caret = caretEl?.selectionStart ?? value.length
    const after = value.slice(caret)
    const mention = `@${contact.adv_name} `
    const next = before + mention + after
    onChange(next)
    setOpen(false)
    setTokenStart(null)
    setQuery("")
    requestAnimationFrame(() => {
      const el = inputRef.current
      if (!el) return
      const pos = (before + mention).length
      el.setSelectionRange(pos, pos)
      el.focus()
    })
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || filtered.length === 0) return
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setSelectedIdx((i) => (i + 1) % filtered.length)
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setSelectedIdx((i) => (i - 1 + filtered.length) % filtered.length)
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault()
      insertMention(filtered[selectedIdx])
    } else if (e.key === "Escape") {
      e.preventDefault()
      setOpen(false)
    }
  }

  return (
    <Popover open={open && filtered.length > 0} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Input
          ref={inputRef}
          value={value}
          onChange={onTextChange}
          onKeyDown={onKeyDown}
          autoComplete="off"
          {...inputProps}
        />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-72 p-0"
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
                  className={selectedIdx === idx ? "bg-accent" : ""}
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
