import { useMemo, useState } from "react"
import { Download, Search } from "lucide-react"
import { useRxLog, type RxEntry } from "@/features/rx_log/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

const ROUTE_TYPES = ["All", "0", "1", "2", "3", "4"] as const
const PAYLOAD_TYPES = ["All", "0", "1", "2", "3", "4", "5", "6", "7"] as const

function formatRecvTime(ms: number | null | undefined): string {
  if (ms == null) return "—"
  return `${ms} ms`
}

function formatRssi(rssi: number | null | undefined): string {
  if (rssi == null) return "—"
  return `${rssi} dBm`
}

function formatSnr(snr: number | null | undefined): string {
  if (snr == null) return "—"
  return `${snr.toFixed(1)} dB`
}

function truncateHash(hash: string | null | undefined): string {
  if (!hash) return "—"
  return hash.length > 8 ? hash.slice(0, 8) : hash
}

function rowMatches(entry: RxEntry, q: string): boolean {
  if (!q) return true
  const needle = q.toLowerCase()
  return (
    (entry.pkt_hash?.toLowerCase().includes(needle) ?? false) ||
    (entry.raw_hex?.toLowerCase().includes(needle) ?? false) ||
    (entry.payload?.toLowerCase().includes(needle) ?? false)
  )
}

function chunkHex(hex: string | null | undefined): string {
  if (!hex) return ""
  const cleaned = hex.replace(/\s+/g, "")
  const bytes = cleaned.match(/.{1,2}/g) ?? []
  const lines: string[] = []
  for (let i = 0; i < bytes.length; i += 16) {
    const offset = i.toString(16).padStart(4, "0")
    const chunk = bytes.slice(i, i + 16).join(" ")
    lines.push(`${offset}  ${chunk}`)
  }
  return lines.join("\n")
}

function Toolbar({
  search,
  setSearch,
  routeFilter,
  setRouteFilter,
  payloadFilter,
  setPayloadFilter,
  paused,
  setPaused,
  filteredCount,
  total,
}: {
  search: string
  setSearch: (v: string) => void
  routeFilter: string
  setRouteFilter: (v: string) => void
  payloadFilter: string
  setPayloadFilter: (v: string) => void
  paused: boolean
  setPaused: (v: boolean) => void
  filteredCount: number
  total: number
}) {
  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b bg-background p-2">
      <div className="relative min-w-[180px] flex-1">
        <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="Search"
          placeholder="Search hash, hex, payload…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8"
        />
      </div>
      <Select value={routeFilter} onValueChange={setRouteFilter}>
        <SelectTrigger aria-label="Route type filter" className="w-[110px]">
          <SelectValue placeholder="Route" />
        </SelectTrigger>
        <SelectContent>
          {ROUTE_TYPES.map((v) => (
            <SelectItem key={v} value={v}>
              {v === "All" ? "All routes" : `Route ${v}`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={payloadFilter} onValueChange={setPayloadFilter}>
        <SelectTrigger aria-label="Payload type filter" className="w-[130px]">
          <SelectValue placeholder="Payload" />
        </SelectTrigger>
        <SelectContent>
          {PAYLOAD_TYPES.map((v) => (
            <SelectItem key={v} value={v}>
              {v === "All" ? "All payloads" : `Payload ${v}`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <label className="flex items-center gap-2 text-sm">
        <Switch
          checked={paused}
          onCheckedChange={setPaused}
          aria-label="Pause stream"
        />
        <span>Pause stream</span>
      </label>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => window.open("/api/rx-log/export?format=csv")}
      >
        <Download className="mr-1 h-4 w-4" />
        CSV
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => window.open("/api/rx-log/export?format=json")}
      >
        <Download className="mr-1 h-4 w-4" />
        JSON
      </Button>
      <Badge variant="secondary" className="ml-auto tabular-nums">
        {filteredCount} of {total}
      </Badge>
    </div>
  )
}

function RxDetailSheet({
  entry,
  open,
  onOpenChange,
}: {
  entry: RxEntry | null
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>RX event details</SheetTitle>
          <SheetDescription>
            {entry?.pkt_hash ?? "—"}
          </SheetDescription>
        </SheetHeader>
        {entry && (
          <div className="flex flex-col gap-3 overflow-y-auto p-4 pt-0">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <div className="text-muted-foreground">Recv time</div>
                <div className="tabular-nums">{formatRecvTime(entry.recv_time)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Length</div>
                <div className="tabular-nums">{entry.payload_length ?? "—"}</div>
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
                <div>{entry.payload_typename ?? entry.payload_type ?? "—"}</div>
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
                <div className="mb-1 text-xs text-muted-foreground">Payload</div>
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

export function RxLogPage() {
  const [paused, setPaused] = useState(false)
  const [search, setSearch] = useState("")
  const [routeFilter, setRouteFilter] = useState<string>("All")
  const [payloadFilter, setPayloadFilter] = useState<string>("All")
  const [selected, setSelected] = useState<RxEntry | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)

  const { data } = useRxLog({ paused })
  const rows = data ?? []

  const filtered = useMemo(() => {
    return rows
      .filter((r) => rowMatches(r, search))
      .filter((r) => {
        if (routeFilter === "All") return true
        return String(r.route_type ?? "") === routeFilter
      })
      .filter((r) => {
        if (payloadFilter === "All") return true
        return String(r.payload_type ?? "") === payloadFilter
      })
  }, [rows, search, routeFilter, payloadFilter])

  const ordered = useMemo(() => [...filtered].reverse(), [filtered])

  const handleRowClick = (entry: RxEntry) => {
    setSelected(entry)
    setSheetOpen(true)
  }

  return (
    <div className="flex h-full flex-col">
      <Toolbar
        search={search}
        setSearch={setSearch}
        routeFilter={routeFilter}
        setRouteFilter={setRouteFilter}
        payloadFilter={payloadFilter}
        setPayloadFilter={setPayloadFilter}
        paused={paused}
        setPaused={setPaused}
        filteredCount={filtered.length}
        total={rows.length}
      />
      <div className="flex-1 overflow-y-auto">
        <div className="overflow-x-auto">
          {ordered.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              No RX events yet. Try sending a message from another mesh node.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>RSSI</TableHead>
                  <TableHead>SNR</TableHead>
                  <TableHead>Len</TableHead>
                  <TableHead>Route</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Hash</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ordered.map((r, i) => (
                  <TableRow
                    key={`${r.pkt_hash ?? "row"}-${i}`}
                    className="cursor-pointer"
                    onClick={() => handleRowClick(r)}
                  >
                    <TableCell className="tabular-nums">
                      {formatRecvTime(r.recv_time)}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {formatRssi(r.rssi)}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {formatSnr(r.snr)}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {r.payload_length ?? "—"}
                    </TableCell>
                    <TableCell>
                      {r.route_typename ?? r.route_type ?? "—"}
                    </TableCell>
                    <TableCell>
                      {r.payload_typename ?? r.payload_type ?? "—"}
                    </TableCell>
                    <TableCell
                      className="font-mono text-xs"
                      title={r.pkt_hash ?? undefined}
                    >
                      {truncateHash(r.pkt_hash)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
      <RxDetailSheet
        entry={selected}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
      />
    </div>
  )
}
