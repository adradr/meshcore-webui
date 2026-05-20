import { BellOff } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { notifyError } from "@/lib/notify"
import { useMutes, useToggleMute } from "@/features/mutes/queries"
import { useContacts } from "@/features/contacts/queries"
import { useChannels } from "@/features/channels/queries"

/**
 * Read-only list of currently muted conversations with a per-row unmute
 * button. Resolves contact/channel names from the existing caches when
 * possible — falls back to the raw key so an orphan mute is still visible
 * and removable.
 */
export function MutedList() {
  const { data, isLoading } = useMutes()
  const { data: contacts } = useContacts()
  const { data: channels } = useChannels()
  const toggle = useToggleMute()

  if (isLoading) {
    return <p className="text-xs text-muted-foreground">Loading…</p>
  }
  const items = data?.items ?? []
  if (items.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Nothing muted. Open a contact or channel and tap the bell icon to
        silence its push notifications.
      </p>
    )
  }

  function nameFor(kind: "contact" | "channel", key: string): string {
    if (kind === "channel") {
      const idx = Number(key)
      const ch = channels?.find((c) => c.channel_idx === idx)
      return ch?.channel_name ?? `Channel ${key}`
    }
    // Match by full-pubkey prefix.
    const entry = contacts
      ? Object.entries(contacts).find(([pk]) =>
          pk.toLowerCase().startsWith(key.toLowerCase()),
        )
      : undefined
    return entry?.[1]?.adv_name ?? key
  }

  return (
    <ul className="max-h-64 space-y-1 overflow-y-auto">
      {items.map((m) => (
        <li
          key={`${m.kind}:${m.key}`}
          className="flex items-center justify-between gap-2 rounded-md border border-border/40 bg-muted/30 px-3 py-2"
        >
          <span className="flex min-w-0 items-center gap-2 text-sm">
            <BellOff className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">
              {nameFor(m.kind, m.key)}
              <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                {m.kind}
              </span>
            </span>
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={toggle.isPending}
            onClick={() =>
              toggle.mutate(
                { kind: m.kind, key: m.key, muted: false },
                {
                  onSuccess: () => toast.success("Unmuted"),
                  onError: (e) => notifyError("Unmute", e),
                },
              )
            }
          >
            Unmute
          </Button>
        </li>
      ))}
    </ul>
  )
}
