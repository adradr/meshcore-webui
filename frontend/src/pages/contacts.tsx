import { useMemo, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { useVirtualizer } from "@tanstack/react-virtual"
import { useContacts, type Contact } from "@/features/contacts/queries"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"

const NODE_TYPE_LABEL: Record<number, string> = {
  1: "CLI",
  2: "REP",
  3: "ROOM",
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?"
}

function relativeTime(epochSeconds: number | null | undefined): string | null {
  if (epochSeconds == null) return null
  const diff = Math.floor(Date.now() / 1000 - epochSeconds)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

interface ContactRow {
  pubKey: string
  name: string
  type: number
  lastAdvert: number | null | undefined
}

export function ContactsPage() {
  const { data, isLoading, isError, error } = useContacts()
  const navigate = useNavigate()
  const parentRef = useRef<HTMLDivElement>(null)

  const rows: ContactRow[] = useMemo(() => {
    if (!data) return []
    return Object.entries(data)
      .map(([pubKey, c]: [string, Contact]) => ({
        pubKey: c.public_key ?? pubKey,
        name: c.adv_name ?? pubKey.slice(0, 8),
        type: c.type ?? 0,
        lastAdvert: c.last_advert ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [data])

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 64,
    overscan: 8,
  })

  if (isLoading) {
    return (
      <div className="space-y-2 p-4">
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-md" />
        ))}
      </div>
    )
  }

  if (isError) {
    return (
      <div className="p-4 text-sm text-destructive">
        Failed to load contacts: {error instanceof Error ? error.message : "unknown"}
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">
        No contacts yet.
      </div>
    )
  }

  return (
    <div ref={parentRef} className="h-full overflow-y-auto">
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const row = rows[virtualRow.index]
          return (
            <button
              key={row.pubKey}
              type="button"
              onClick={() => navigate(`/chat/${row.pubKey}`)}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
              }}
              className="flex w-full items-center gap-3 border-b px-4 text-left hover:bg-accent"
            >
              <Avatar>
                <AvatarFallback>{initials(row.name)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{row.name}</span>
                  {NODE_TYPE_LABEL[row.type] && (
                    <Badge variant="secondary" className="h-4 text-[10px]">
                      {NODE_TYPE_LABEL[row.type]}
                    </Badge>
                  )}
                </div>
                {relativeTime(row.lastAdvert) && (
                  <div className="text-[11px] text-muted-foreground">
                    last seen {relativeTime(row.lastAdvert)}
                  </div>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
