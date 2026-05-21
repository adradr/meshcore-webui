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
  /**
   * The hex-encoded path THIS specific message took to reach us, if known
   * (populated by the backend when the meshcore lib correlated the message
   * with its RX_LOG_DATA entry). When provided, this is preferred over the
   * contact's cached out_path — per-message path is the literal route the
   * packet just travelled, distinct from "the path we'd use to reply".
   * For channel messages, this is the ONLY source of path data since
   * channels don't have a cached out_path.
   */
  messagePath?: string | null
}

export function HeardRepeatsSheet({
  open,
  onOpenChange,
  contactPubKey,
  messagePath,
}: Props) {
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
  const contactPath = (peer as { path?: string | null } | undefined)?.path
  // Prefer the message-level path when present (channel messages have this
  // but no contact). Falls back to the contact's cached out_path for DMs.
  const rawPath = messagePath ?? contactPath
  const haveMessagePath = messagePath != null && messagePath !== undefined
  const pathIsUnknown =
    !haveMessagePath &&
    peer != null &&
    (contactPath === null || contactPath === undefined)
  const hops = parseRepeaterPath(rawPath ?? null, contacts.data ?? {})
  // Channel messages with a per-message path: render the same hop list but
  // skip the "Discover path" / "Contact not found" branches that only make
  // sense for DM peers.
  const isChannelWithPath = !contactPubKey && haveMessagePath

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="sm:max-w-md sm:mx-auto">
        <SheetHeader>
          <SheetTitle>Heard via repeaters</SheetTitle>
          <SheetDescription>
            {contactPubKey
              ? "Repeater path most recently observed for this contact."
              : haveMessagePath
                ? "Repeater path this channel message took to reach us."
                : "Channel message — path data not captured for this packet."}
          </SheetDescription>
        </SheetHeader>
        <div className="p-4">
          {!contactPubKey && !haveMessagePath ? (
            <p className="text-sm text-muted-foreground">
              No path recorded — this message arrived before the radio
              captured its RX log entry, or the channel decrypt feature
              is disabled.
            </p>
          ) : !contactPubKey && isChannelWithPath ? (
            hops.length === 0 ? (
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
            )
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
