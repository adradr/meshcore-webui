import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import { useContacts, useContact } from "@/features/contacts/queries"
import { parseRepeaterPath } from "./repeaterPath"
import type { Message } from "./queries"

interface Props {
  message: Message | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

function fmtAbs(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

/**
 * Power-user metadata view for a single message: timing, packet headers,
 * repeater path (if a path is known on the contact), and the raw content.
 */
export function MessageDetailsSheet({ message, open, onOpenChange }: Props) {
  const { data: contacts } = useContacts()
  const { contact } = useContact(message?.contact_pub_key ?? undefined)
  if (!message) return null
  const pathHex = contact?.out_path ?? contact?.path ?? null
  const hops = pathHex ? parseRepeaterPath(pathHex, contacts ?? {}) : []
  const ackDeltaMs =
    message.ack_received_at && message.timestamp
      ? new Date(message.ack_received_at).getTime() -
        new Date(message.timestamp).getTime()
      : null

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[80vh] overflow-y-auto p-4 sm:max-w-md"
      >
        <SheetHeader className="p-0">
          <SheetTitle>Message details</SheetTitle>
          <SheetDescription>
            {message.direction === "out" ? "Sent" : "Received"} message metadata
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-4 text-sm">
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Timing
            </h3>
            <Row label="Sent">{fmtAbs(message.timestamp)}</Row>
            {message.ack_received_at && (
              <Row label="Acked">{fmtAbs(message.ack_received_at)}</Row>
            )}
            {ackDeltaMs != null && (
              <Row label="ACK latency">{(ackDeltaMs / 1000).toFixed(1)}s</Row>
            )}
          </section>
          <Separator />
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Packet
            </h3>
            <Row label="Type">
              <Badge variant="secondary">{message.msg_type}</Badge>
            </Row>
            <Row label="Direction">
              {message.direction === "out" ? "Outgoing" : "Incoming"}
            </Row>
            <Row label="Status">
              <Badge
                variant={
                  message.ack_state === "failed" ? "destructive" : "secondary"
                }
              >
                {message.ack_state}
              </Badge>
            </Row>
            {message.expected_ack_hex && (
              <Row label="Expected ACK">
                <code className="text-[10px]">{message.expected_ack_hex}</code>
              </Row>
            )}
            {message.pubkey_prefix && (
              <Row label="Sender prefix">
                <code className="text-[10px]">{message.pubkey_prefix}</code>
              </Row>
            )}
            {message.channel_idx != null && (
              <Row label="Channel">#{message.channel_idx}</Row>
            )}
          </section>
          {hops.length > 0 && (
            <>
              <Separator />
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Path
                </h3>
                <ol className="space-y-1">
                  {hops.map((h, i) => (
                    <li key={i} className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground">{i + 1}.</span>
                      <span
                        className={h.resolved ? "" : "italic text-muted-foreground"}
                      >
                        {h.name}
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
            </>
          )}
          <Separator />
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Content
            </h3>
            <pre className="whitespace-pre-wrap break-words rounded-md bg-muted p-2 text-xs">
              {message.text}
            </pre>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-xs font-medium tabular-nums">{children}</span>
    </div>
  )
}
