/**
 * TraceMonitorStatsCard — rolling-window summary over the same in-memory
 * samples buffer the chart consumes.
 *
 * Pure-presentational: every number comes from ``stats.ts`` helpers, this
 * file only formats them. Returns ``null`` for empty input so the panel
 * doesn't render an empty card on first mount (same pattern as
 * ``RecordingsList``).
 */
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

import type { TraceSample } from "./api"
import {
  computePathStability,
  computeStats,
  type SnrStats,
} from "./stats"

export interface TraceMonitorStatsCardProps {
  samples: TraceSample[]
}

function formatPct(v: number): string {
  // ``Math.round`` on the percentage matches what the test expects (`67%`
  // for 2/3). For 0/0 the panel returns null before we get here.
  return `${Math.round(v * 100)}%`
}

function formatDb(v: number): string {
  // One decimal is plenty for SNR display — the chart already shows this
  // granularity. ``tabular-nums`` on the parent <dl> keeps columns aligned.
  return `${v.toFixed(1)} dB`
}

interface SnrColumnProps {
  label: string
  stats: SnrStats | null
}

function SnrColumn({ label, stats }: SnrColumnProps) {
  if (!stats) {
    return (
      <div>
        <h4 className="text-sm font-medium text-muted-foreground">{label}</h4>
        <p className="mt-1 text-sm">—</p>
      </div>
    )
  }
  const rows: Array<[string, number]> = [
    ["min", stats.min],
    ["max", stats.max],
    ["avg", stats.avg],
    ["median", stats.median],
    ["p95", stats.p95],
  ]
  return (
    <div>
      <h4 className="text-sm font-medium text-muted-foreground">{label}</h4>
      <dl className="mt-1 grid grid-cols-2 gap-x-3 text-sm tabular-nums">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="text-right">{formatDb(v)}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

interface SuccessColumnProps {
  ok: number
  total: number
  successRate: number
  statusBreakdown: Record<string, number>
}

function SuccessColumn({
  ok,
  total,
  successRate,
  statusBreakdown,
}: SuccessColumnProps) {
  const failures = Object.entries(statusBreakdown).sort(
    ([a], [b]) => a.localeCompare(b),
  )
  return (
    <div>
      <h4 className="text-sm font-medium text-muted-foreground">
        Success rate
      </h4>
      <p className="mt-1 text-3xl font-semibold tabular-nums">
        {formatPct(successRate)}
      </p>
      <p className="text-xs text-muted-foreground tabular-nums">
        {ok}/{total} samples
      </p>
      {failures.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
          {failures.map(([status, n]) => (
            <li key={status} className="tabular-nums">
              × {n} {status}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

interface PathStabilityRowProps {
  stability: number | null
  ok: number
}

function PathStabilityRow({ stability, ok }: PathStabilityRowProps) {
  if (stability === null) {
    return (
      <div className="border-t pt-3 text-sm">
        <span className="font-medium">Path stability:</span>{" "}
        <span className="text-muted-foreground">—</span>
      </div>
    )
  }
  const matching = Math.round(stability * ok)
  return (
    <div className="border-t pt-3 text-sm">
      <span className="font-medium">Path stability:</span>{" "}
      <span className="tabular-nums">
        {formatPct(stability)} ({matching} of {ok} samples)
      </span>
    </div>
  )
}

export function TraceMonitorStatsCard({ samples }: TraceMonitorStatsCardProps) {
  if (samples.length === 0) return null
  const stats = computeStats(samples)
  const stability = computePathStability(samples)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Statistics</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <SuccessColumn
            ok={stats.ok}
            total={stats.total}
            successRate={stats.successRate}
            statusBreakdown={stats.statusBreakdown}
          />
          <SnrColumn label="SNR there" stats={stats.snrThere} />
          <SnrColumn label="SNR back" stats={stats.snrBack} />
        </div>
        <PathStabilityRow stability={stability} ok={stats.ok} />
      </CardContent>
    </Card>
  )
}
