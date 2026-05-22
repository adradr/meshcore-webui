import { useMemo, useState } from "react"
import { Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { ContactAvatar } from "@/components/contact-avatar"
import { Badge } from "@/components/ui/badge"
import { useContacts, type Contact } from "@/features/contacts/queries"

const NODE_TYPE_LABEL: Record<number, string> = {
  1: "CLI",
  2: "REP",
  3: "ROOM",
  4: "SENS",
}

interface Row {
  pubKey: string
  name: string
  type: number
}

interface Props {
  /**
   * Called when the user taps a contact row. Parent is responsible for
   * triggering the share mutation and inserting the resulting URI into
   * the composer.
   */
  onPick: (pubKey: string) => void
  /** Optional pubKey filter to hide (e.g. exclude the user's own node). */
  excludePubKey?: string
}

/**
 * Inline contact picker used inside the composer attachment Sheet for
 * the "Share a contact" action. Keeps its own search filter; the parent
 * decides what to do with the selection (call useShareContact, etc).
 */
export function SharedContactPicker({ onPick, excludePubKey }: Props) {
  const { data, isLoading } = useContacts()
  const [filter, setFilter] = useState("")

  const rows: Row[] = useMemo(() => {
    if (!data) return []
    return Object.entries(data)
      .map(([pubKey, c]: [string, Contact]) => ({
        pubKey: c.public_key ?? pubKey,
        name: c.adv_name ?? pubKey.slice(0, 8),
        type: c.type ?? 0,
      }))
      .filter((r) => !excludePubKey || r.pubKey !== excludePubKey)
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [data, excludePubKey])

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.pubKey.toLowerCase().startsWith(q),
    )
  }, [rows, filter])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search contacts…"
          className="pl-8"
          aria-label="Search contacts to share"
          autoFocus
        />
      </div>
      <div
        className="min-h-0 flex-1 overflow-y-auto rounded-md border"
        data-testid="shared-contact-picker-list"
      >
        {isLoading ? (
          <div className="p-4 text-center text-xs text-muted-foreground">
            Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-4 text-center text-xs text-muted-foreground">
            {rows.length === 0 ? "No contacts." : "No matches."}
          </div>
        ) : (
          <ul>
            {filtered.map((row) => (
              <li key={row.pubKey}>
                <button
                  type="button"
                  onClick={() => onPick(row.pubKey)}
                  className="flex w-full items-center gap-3 border-b px-3 py-2 text-left text-sm transition-colors last:border-b-0 hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                >
                  <ContactAvatar
                    pubkey={row.pubKey}
                    name={row.name}
                    size="sm"
                  />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {row.name}
                  </span>
                  {NODE_TYPE_LABEL[row.type] && (
                    <Badge variant="secondary" className="h-5 text-[10px]">
                      {NODE_TYPE_LABEL[row.type]}
                    </Badge>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
