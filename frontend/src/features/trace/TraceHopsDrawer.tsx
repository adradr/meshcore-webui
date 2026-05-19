import { CheckCircle2, HelpCircle, MapPin, AlertTriangle } from "lucide-react"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { TraceHopOut, TraceOut } from "./api"

interface TraceHopsDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  trace: TraceOut | null
}

/**
 * Per-hop SNR/RSSI detail drawer for an active trace.
 *
 * v1: no "ping this hop" action — that requires a higher-level orchestrator
 * (trace ➜ pick hop ➜ direct probe) that we haven't wired yet.
 */
export function TraceHopsDrawer({
  open,
  onOpenChange,
  trace,
}: TraceHopsDrawerProps) {
  if (!trace) return null

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex flex-col gap-0 p-0">
        <SheetHeader className="border-b">
          <SheetTitle>Trace hops</SheetTitle>
          <SheetDescription>
            {trace.hops.length} hop(s) — tag #{trace.tag}
          </SheetDescription>
        </SheetHeader>
        <ScrollArea className="flex-1">
          <ol className="flex flex-col gap-3 p-4">
            {trace.hops.map((hop, idx) => (
              <HopRow key={`${hop.hash}-${idx}`} hop={hop} index={idx} />
            ))}
          </ol>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}

interface HopRowProps {
  hop: TraceHopOut
  index: number
}

function HopRow({ hop, index }: HopRowProps) {
  const status = hopStatus(hop)
  return (
    <li className="bg-card flex flex-col gap-1.5 rounded-md border p-3 text-xs shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="font-semibold">Hop {index + 1}</div>
        <StatusBadge status={status} candidateCount={hop.candidates.length} />
      </div>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        {hop.name ? (
          <span className="font-medium">{hop.name}</span>
        ) : (
          <span className="font-mono text-muted-foreground">
            (hash: {hop.hash})
          </span>
        )}
        {hop.pub_key && (
          <span className="font-mono text-muted-foreground">
            {shortPubkey(hop.pub_key)}
          </span>
        )}
      </div>
      <div className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5">
        <span>SNR: {hop.snr.toFixed(1)} dB</span>
        <span>RSSI: —</span>
      </div>
      {hop.lat != null && hop.lon != null && (
        <div className="text-muted-foreground flex items-center gap-1 font-mono">
          <MapPin className="h-3 w-3" />
          {hop.lat.toFixed(4)}, {hop.lon.toFixed(4)}
        </div>
      )}
    </li>
  )
}

type HopStatus = "resolved" | "ambiguous" | "unknown"

function hopStatus(hop: TraceHopOut): HopStatus {
  if (hop.pub_key) return "resolved"
  if (hop.candidates.length > 1) return "ambiguous"
  return "unknown"
}

function StatusBadge({
  status,
  candidateCount,
}: {
  status: HopStatus
  candidateCount: number
}) {
  if (status === "resolved") {
    return (
      <Badge
        variant="outline"
        className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      >
        <CheckCircle2 className="h-3 w-3" />
        resolved
      </Badge>
    )
  }
  if (status === "ambiguous") {
    return (
      <Badge
        variant="outline"
        className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
      >
        <AlertTriangle className="h-3 w-3" />
        ambiguous — {candidateCount} candidates
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="text-muted-foreground">
      <HelpCircle className="h-3 w-3" />
      unknown
    </Badge>
  )
}

function shortPubkey(pk: string): string {
  if (pk.length <= 16) return pk
  return `${pk.slice(0, 12)}…${pk.slice(-4)}`
}
