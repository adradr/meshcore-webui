import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import type { RxEntry } from "@/features/rx_log/api"
import {
  chunkHex,
  formatRecvClock,
  formatRssi,
  formatSnr,
  relativeTime,
} from "@/features/rx_log/format"

export interface RxDetailSheetProps {
  entry: RxEntry | null
  open: boolean
  onOpenChange: (v: boolean) => void
}

export function RxDetailSheet({ entry, open, onOpenChange }: RxDetailSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>RX event details</SheetTitle>
          <SheetDescription>{entry?.pkt_hash ?? "—"}</SheetDescription>
        </SheetHeader>
        {entry && (
          <div className="flex flex-col gap-3 overflow-y-auto p-4 pt-0">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <div className="text-muted-foreground">Recv time</div>
                <div className="tabular-nums">
                  {formatRecvClock(entry.recv_time)}
                </div>
                <div className="text-muted-foreground">
                  {relativeTime(entry.recv_time)}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">Length</div>
                <div className="tabular-nums">
                  {entry.payload_length ?? "—"}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">RSSI</div>
                <div className="tabular-nums">{formatRssi(entry.rssi)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">SNR</div>
                <div className="tabular-nums">{formatSnr(entry.snr)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Route</div>
                <div>{entry.route_typename ?? entry.route_type ?? "—"}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Type</div>
                <div>
                  {entry.payload_typename ?? entry.payload_type ?? "—"}
                </div>
              </div>
              <div className="col-span-2">
                <div className="text-muted-foreground">Path</div>
                <div className="font-mono text-xs break-all">
                  {entry.path || "—"}
                </div>
              </div>
            </div>
            {entry.payload && (
              <div>
                <div className="mb-1 text-xs text-muted-foreground">
                  Payload
                </div>
                <pre className="overflow-x-auto rounded bg-muted p-2 font-mono text-xs">
                  {entry.payload}
                </pre>
              </div>
            )}
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Raw hex</div>
              <pre className="overflow-x-auto rounded bg-muted p-2 font-mono text-xs">
                {chunkHex(entry.raw_hex) || "—"}
              </pre>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
