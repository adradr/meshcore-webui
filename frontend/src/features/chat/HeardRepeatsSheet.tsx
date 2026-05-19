import { Loader2, Radio, Search } from "lucide-react"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { useContacts, useDiscoverPath } from "@/features/contacts/queries"
import { parseRepeaterPath } from "./repeaterPath"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** pub_key prefix of the DM peer, or null for channel messages / unknown. */
  contactPubKey: string | null
}

export function HeardRepeatsSheet({ open, onOpenChange, contactPubKey }: Props) {
  const contacts = useContacts()
  const discoverPath = useDiscoverPath()

  const peer = contactPubKey
    ? Object.values(contacts.data ?? {}).find((c) =>
        c.public_key?.toLowerCase().startsWith(contactPubKey.toLowerCase()),
      )
    : undefined
  // Distinguish "no path stored" from "explicit empty path" (= direct).
  // The contact's `path` is null/undefined when discovery has never run, and
  // empty string when the device has explicitly reported a direct/flooded link.
  const rawPath = (peer as { path?: string | null } | undefined)?.path
  const pathIsUnknown = peer != null && (rawPath === null || rawPath === undefined)
  const hops = parseRepeaterPath(rawPath ?? null, contacts.data ?? {})

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="sm:max-w-md sm:mx-auto">
        <SheetHeader>
          <SheetTitle>Heard via repeaters</SheetTitle>
          <SheetDescription>
            {contactPubKey
              ? "Repeater path most recently observed for this contact."
              : "Channel message — repeater path varies per relay."}
          </SheetDescription>
        </SheetHeader>
        <div className="p-4">
          {!contactPubKey ? (
            <p className="text-sm text-muted-foreground">
              Not applicable for channel messages.
            </p>
          ) : !peer ? (
            <p className="text-sm text-muted-foreground">
              Contact not found in the local list.
            </p>
          ) : pathIsUnknown ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                No path discovered yet for this contact.
              </p>
              <Button
                size="sm"
                onClick={() =>
                  discoverPath.mutate({
                    pubkey: peer.public_key ?? contactPubKey,
                  })
                }
                disabled={discoverPath.isPending}
              >
                {discoverPath.isPending ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Search className="mr-1.5 h-3.5 w-3.5" />
                )}
                {discoverPath.isPending ? "Discovering…" : "Discover path"}
              </Button>
            </div>
          ) : hops.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Direct (no repeaters in path).
            </p>
          ) : (
            <ol className="space-y-2">
              {hops.map((h, i) => (
                <li
                  key={`${i}-${h.hash}`}
                  className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-sm"
                >
                  <Radio className="h-4 w-4 shrink-0 opacity-70" />
                  <span className="font-medium">{h.name}</span>
                  <span className="ml-auto font-mono text-xs text-muted-foreground">
                    {h.hash}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
