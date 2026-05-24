/**
 * RecordingsList — historical trace-monitor sessions for one contact, with a
 * per-row "Download CSV" action.
 *
 * Sessions are passed in from the parent (which already fetches them via
 * ``useTraceMonitorSessions``). Sample fetching is deferred to click-time —
 * we use the existing TanStack Query cache key (``samplesKey``) via
 * ``queryClient.fetchQuery`` so a repeat download on the same session is
 * cache-served. The CSV is built client-side with ``samplesToCsv``.
 */
import { useState } from "react"
import { Download, Loader2 } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { api } from "@/lib/api"
import { notifyError } from "@/lib/notify"

import {
  TraceSamplesPageSchema,
  type TraceSample,
  type TraceSamplesPage,
  type TraceSessionSummary,
} from "./api"
import {
  csvFilenameFor,
  defaultCsvDownloader,
  samplesToCsv,
  type CsvDownloader,
} from "./csv"

export interface RecordingsListProps {
  sessions: TraceSessionSummary[]
  /** Test seam — overrides the default Blob+anchor download mechanism. */
  downloader?: CsvDownloader
}

/**
 * Roughly format a duration in seconds → "Xs" / "XmYs" / "Xh".
 * Sub-minute resolution covers the realistic "I started a 5-min monitor"
 * case without spelling out hours that never happen.
 */
function formatDuration(firstAt: string, lastAt: string): string {
  const start = Date.parse(firstAt)
  const end = Date.parse(lastAt)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return "—"
  }
  const sec = Math.round((end - start) / 1000)
  if (sec < 60) return `${sec}s`
  const m = Math.floor(sec / 60)
  const s = sec % 60
  if (m < 60) return s === 0 ? `${m}m` : `${m}m ${s}s`
  const h = Math.floor(m / 60)
  const rm = m % 60
  return rm === 0 ? `${h}h` : `${h}h ${rm}m`
}

function formatStarted(firstAt: string): string {
  const d = new Date(firstAt)
  if (Number.isNaN(d.getTime())) return firstAt
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function RecordingsList({
  sessions,
  downloader = defaultCsvDownloader,
}: RecordingsListProps) {
  const qc = useQueryClient()
  // Track which session is currently downloading so the row can spin and
  // a second click on the same row is ignored.
  const [busy, setBusy] = useState<string | null>(null)

  if (sessions.length === 0) {
    return null
  }

  const handleDownload = async (s: TraceSessionSummary) => {
    if (busy) return
    setBusy(s.session_id)
    try {
      // Use the same cache key shape the live-chart hook uses
      // (``["trace-monitor", "samples", sessionId]``) so a session that was
      // recently viewed in the chart doesn't refetch from the network.
      const page = await qc.fetchQuery<TraceSample[]>({
        queryKey: ["trace-monitor", "samples", s.session_id],
        queryFn: async () => {
          const r = await api.get<TraceSamplesPage>(
            `/api/trace/monitor/${s.session_id}/samples?limit=10000`,
            TraceSamplesPageSchema,
          )
          return r.items
        },
        staleTime: Infinity,
      })
      const csv = samplesToCsv(page)
      const name = csvFilenameFor(s.target_pubkey, s.first_sample_at)
      downloader.download(name, csv)
    } catch (e) {
      notifyError("Export CSV", e as Error)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Past recordings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <ul className="divide-y divide-border/60">
          {sessions.map((s) => {
            const downloading = busy === s.session_id
            return (
              <li
                key={s.session_id}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">
                    {formatStarted(s.first_sample_at)}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {s.samples_total} sample{s.samples_total === 1 ? "" : "s"}
                    {" · "}
                    {formatDuration(s.first_sample_at, s.last_sample_at)}
                    {" · "}
                    <span className="text-emerald-600 dark:text-emerald-400">
                      {s.ok_count} ok
                    </span>
                    {" / "}
                    <span className="text-amber-600 dark:text-amber-400">
                      {s.error_count} fail
                    </span>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleDownload(s)}
                  disabled={downloading || !!busy}
                  aria-label={`Download recording from ${s.first_sample_at} as CSV`}
                >
                  {downloading ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Download className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  CSV
                </Button>
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}
