import { Radio } from "lucide-react"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { useContacts } from "@/features/contacts/queries"
import { parseRepeaterPath } from "./repeaterPath"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** pub_key prefix of the DM peer, or null for channel messages / unknown. */
  contactPubKey: string | null
}

export function HeardRepeatsSheet({ open, onOpenChange, contactPubKey }: Props) {
  const contacts = useContacts()

  const peer = contactPubKey
    ? Object.values(contacts.data ?? {}).find((c) =>
        c.public_key?.toLowerCase().startsWith(contactPubKey.toLowerCase()),
      )
    : undefined
  const pathHex = (peer as { path?: string | null } | undefined)?.path ?? null
  const hops = parseRepeaterPath(pathHex, contacts.data ?? {})

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="sm:max-w-md sm:mx-auto">
        <SheetHeader>
          <SheetTitle>Heard via repeaters</SheetTitle>
          <SheetDescription>
            {contactPubKey
              ? "Repeater path most recently observed for this contact."
              : "Path information is only available for direct-message peers."}
          </SheetDescription>
        </SheetHeader>
        <div className="p-4">
          {!contactPubKey ? (
            <p className="text-sm text-muted-foreground">Unknown path.</p>
          ) : !peer ? (
            <p className="text-sm text-muted-foreground">
              Contact not found in the local list.
            </p>
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
