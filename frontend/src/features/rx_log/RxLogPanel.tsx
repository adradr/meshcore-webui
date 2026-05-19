import { useEffect, useMemo, useRef, useState } from "react"
import {
  serialiseCsv,
  serialiseJson,
  useRxLog,
  type RxEntry,
} from "@/features/rx_log/api"
import {
  deriveOptions,
  formatRecvClock,
  formatRssi,
  formatSnr,
  relativeTime,
  rowMatches,
  truncateHash,
} from "@/features/rx_log/format"
import { RxDetailSheet } from "@/features/rx_log/RxDetailSheet"
import { RxToolbar } from "@/features/rx_log/RxToolbar"
import { downloadBlob } from "@/lib/download"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

// Re-exports for tests that still import these helpers from the panel module.
export {
  deriveOptions,
  formatRecvClock,
  relativeTime,
} from "@/features/rx_log/format"

const SCROLL_BOTTOM_THRESHOLD_PX = 40

/**
 * Body of the RX log view. Renders inside a Tabs panel on the /device page;
 * does NOT own page-level chrome (header, container) so it can be embedded.
 */
export function RxLogPanel() {
  const [paused, setPaused] = useState(false)
  const [search, setSearch] = useState("")
  const [routeFilter, setRouteFilter] = useState<string>("All")
  const [payloadFilter, setPayloadFilter] = useState<string>("All")
  const [selected, setSelected] = useState<RxEntry | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [isAtBottom, setIsAtBottom] = useState(true)

  const scrollContainerRef = useRef<HTMLDivElement | null>(null)

  const { data } = useRxLog({ paused })
  const rows = data ?? []

  const routeOptions = useMemo(
    () => deriveOptions(rows, "route_typename"),
    [rows],
  )
  const payloadOptions = useMemo(
    () => deriveOptions(rows, "payload_typename"),
    [rows],
  )

  const filtered = useMemo(() => {
    return rows
      .filter((r) => rowMatches(r, search))
      .filter((r) => {
        if (routeFilter === "All") return true
        return r.route_typename === routeFilter
      })
      .filter((r) => {
        if (payloadFilter === "All") return true
        return r.payload_typename === payloadFilter
      })
  }, [rows, search, routeFilter, payloadFilter])

  // Newest-on-bottom (chat-style). When user is at bottom, auto-follow.
  const ordered = filtered

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    const distanceFromBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight
    setIsAtBottom(distanceFromBottom <= SCROLL_BOTTOM_THRESHOLD_PX)
  }

  // Auto-follow tail: when new rows arrive and the user is pinned to the
  // bottom (and not paused), keep them pinned. If the user scrolled away,
  // do not yank them back.
  useEffect(() => {
    if (paused) return
    if (!isAtBottom) return
    const el = scrollContainerRef.current
    if (!el) return
    if (typeof el.scrollTo === "function") {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
    } else {
      // jsdom and very old browsers may not implement scrollTo; fall back.
      el.scrollTop = el.scrollHeight
    }
    // We intentionally do not include isAtBottom in deps: only re-run when
    // the visible row count changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordered.length, paused])

  const handleRowClick = (entry: RxEntry) => {
    setSelected(entry)
    setSheetOpen(true)
  }

  const exportCsv = () => {
    const ts = Date.now()
    downloadBlob(serialiseCsv(filtered), `rx-log-${ts}.csv`, "text/csv")
  }
  const exportJson = () => {
    const ts = Date.now()
    downloadBlob(
      serialiseJson(filtered),
      `rx-log-${ts}.json`,
      "application/json",
    )
  }

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col">
        <RxToolbar
          search={search}
          setSearch={setSearch}
          routeFilter={routeFilter}
          setRouteFilter={setRouteFilter}
          payloadFilter={payloadFilter}
          setPayloadFilter={setPayloadFilter}
          routeOptions={routeOptions}
          payloadOptions={payloadOptions}
          paused={paused}
          setPaused={setPaused}
          filteredCount={filtered.length}
          total={rows.length}
          onExportCsv={exportCsv}
          onExportJson={exportJson}
        />
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto"
          data-testid="rx-log-scroll"
        >
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
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span>{formatRecvClock(r.recv_time)}</span>
                          </TooltipTrigger>
                          <TooltipContent>
                            {relativeTime(r.recv_time)}
                          </TooltipContent>
                        </Tooltip>
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
    </TooltipProvider>
  )
}
