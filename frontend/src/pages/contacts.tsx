import { useMemo, useRef, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { useVirtualizer } from "@tanstack/react-virtual"
import { Plus, Search, Star } from "lucide-react"
import {
  useContacts,
  useContactsStats,
  useImportContact,
  useSetFlags,
  type Contact,
} from "@/features/contacts/queries"
import {
  CONTACT_SORTS,
  CONTACT_SORT_LABELS,
  loadContactSort,
  saveContactSort,
  sortContacts,
  type ContactSort,
} from "@/features/contacts/sort"
import { formatLastSeen } from "@/features/rx_log/format"
import { ContactAvatar } from "@/components/contact-avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { PageShell } from "@/components/page-shell"
import { PageHeader } from "@/components/page-header"

const NODE_TYPE_LABEL: Record<number, string> = {
  1: "CLI",
  2: "REP",
  3: "ROOM",
  4: "SENS",
}

const STAR_FLAG = 0x01

interface ContactRow {
  pubKey: string
  name: string
  type: number
  starred: boolean
  lastAdvert: number | null | undefined
}

interface ImportDialogProps {
  open: boolean
  onOpenChange: (v: boolean) => void
}

function ImportDialog({ open, onOpenChange }: ImportDialogProps) {
  const [value, setValue] = useState("")
  const importMutation = useImportContact()

  const handleSubmit = () => {
    const uri = value.trim()
    if (!uri) return
    importMutation.mutate(
      { uri },
      {
        onSuccess: () => {
          setValue("")
          onOpenChange(false)
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import contact</DialogTitle>
          <DialogDescription>
            Paste a <code className="rounded bg-muted px-1 text-xs">meshcore://</code> URI shared from another node.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="contact-uri">Contact URI</Label>
          <Textarea
            id="contact-uri"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="meshcore://..."
            rows={4}
            className="font-mono text-xs"
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!value.trim() || importMutation.isPending}
          >
            {importMutation.isPending ? "Importing…" : "Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ContactsPage() {
  const { data, isLoading, isError, error } = useContacts()
  const { data: stats } = useContactsStats()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const parentRef = useRef<HTMLDivElement>(null)
  // Initial filter from ?q=... so chat sender clicks can deep-link a search
  const [filter, setFilter] = useState(() => searchParams.get("q") ?? "")
  const [importOpen, setImportOpen] = useState(false)
  const [sort, setSortState] = useState<ContactSort>(loadContactSort)
  const flags = useSetFlags()

  const setSort = (mode: ContactSort) => {
    setSortState(mode)
    saveContactSort(mode)
  }

  const sorted: ContactRow[] = useMemo(() => {
    if (!data) return []
    const items = Object.entries(data).map(
      ([pubKey, c]: [string, Contact]) => ({
        pubkey: c.public_key ?? pubKey,
        contact: c,
        stats: stats?.[c.public_key ?? pubKey],
      }),
    )
    const ordered = sortContacts(items, sort)
    return ordered.map(({ pubkey, contact }) => ({
      pubKey: pubkey,
      name: contact.adv_name ?? pubkey.slice(0, 8),
      type: contact.type ?? 0,
      starred: Boolean((contact.flags ?? 0) & STAR_FLAG),
      lastAdvert: contact.last_advert ?? null,
    }))
  }, [data, stats, sort])

  const filtered: ContactRow[] = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return sorted
    return sorted.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.pubKey.toLowerCase().startsWith(q),
    )
  }, [sorted, filter])

  const rowVirtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 64,
    overscan: 8,
  })

  const importAction = (
    <Dialog open={importOpen} onOpenChange={setImportOpen}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0 gap-1"
          aria-label="Import contact"
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Import</span>
        </Button>
      </DialogTrigger>
    </Dialog>
  )

  if (isLoading) {
    return (
      <PageShell
        header={<PageHeader title="Contacts" actions={importAction} />}
      >
        <div className="space-y-2">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-md" />
          ))}
        </div>
        <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
      </PageShell>
    )
  }

  if (isError) {
    return (
      <PageShell
        header={<PageHeader title="Contacts" actions={importAction} />}
      >
        <div className="text-sm text-destructive">
          Failed to load contacts:{" "}
          {error instanceof Error ? error.message : "unknown"}
        </div>
        <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
      </PageShell>
    )
  }

  return (
    <PageShell
      header={<PageHeader title="Contacts" actions={importAction} />}
      contentClassName="p-0"
      scrollRef={parentRef}
    >
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background/95 px-3 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search contacts..."
            enterKeyHint="search"
            className="pl-8"
            aria-label="Search contacts"
          />
        </div>
        <Select value={sort} onValueChange={(v) => setSort(v as ContactSort)}>
          <SelectTrigger
            aria-label="Sort contacts"
            className="h-9 w-[140px] shrink-0"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {CONTACT_SORTS.map((mode) => (
              <SelectItem key={mode} value={mode}>
                {CONTACT_SORT_LABELS[mode]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Badge variant="secondary" className="shrink-0 tabular-nums">
          {filtered.length} of {sorted.length}
        </Badge>
      </div>

      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />

      {filtered.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">
          {sorted.length === 0 ? "No contacts yet." : "No matches."}
        </div>
      ) : (
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: "100%",
            position: "relative",
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const row = filtered[virtualRow.index]
            const lastSeen = formatLastSeen(row.lastAdvert)
            return (
              <div
                key={row.pubKey}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                className="flex items-center gap-3 border-b px-3 transition-colors hover:bg-accent/40"
              >
                <button
                  type="button"
                  aria-label={row.starred ? "Unstar contact" : "Star contact"}
                  aria-pressed={row.starred}
                  onClick={(e) => {
                    e.stopPropagation()
                    flags.mutate({ pubkey: row.pubKey, starred: !row.starred })
                  }}
                  className="-ml-1 grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <Star
                    className={
                      row.starred
                        ? "h-4 w-4 fill-yellow-400 text-yellow-500"
                        : "h-4 w-4"
                    }
                  />
                </button>
                <button
                  type="button"
                  onClick={() => navigate(`/contact/${row.pubKey}`)}
                  className="flex min-w-0 flex-1 items-center gap-3 py-2 text-left"
                >
                  <ContactAvatar pubkey={row.pubKey} name={row.name} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{row.name}</span>
                    </div>
                    {lastSeen && (
                      <div className="text-[11px] text-muted-foreground">
                        last seen {lastSeen}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {NODE_TYPE_LABEL[row.type] && (
                      <Badge variant="secondary" className="h-5 text-[10px]">
                        {NODE_TYPE_LABEL[row.type]}
                      </Badge>
                    )}
                  </div>
                </button>
              </div>
            )
          })}
        </div>
      )}
    </PageShell>
  )
}
