/**
 * TraceMonitorPanel — contact-scoped controls + chart for the continuous
 * trace monitor.
 *
 * Mirrors LinkDiagnosticPanel's role inside contact-detail.tsx: one Card with
 * status-aware chrome, an interval slider, Start/Stop/Take-over actions, an
 * optional "Wipe history" danger button, a last-sample summary line, and a
 * chart hydrated either from the live session or the most-recent historical
 * session for the same target.
 *
 * The panel is "dumb" w.r.t. RF — it only reads the Task-6 hooks and forwards
 * samples to the Task-7 chart. Presentational sub-components live in
 * ``TraceMonitorPanelParts.tsx`` to keep this file under the 400-LOC ceiling.
 */
import { useMemo, useState } from "react"
import { Loader2, Play, Square } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"

import {
  useDeleteTraceMonitorSession,
  useStartTraceMonitor,
  useStopTraceMonitor,
  useTraceMonitorSamples,
  useTraceMonitorSessions,
  useTraceMonitorStatus,
} from "./api"
import { RecordingsList } from "./RecordingsList"
import { TraceMonitorChart } from "./TraceMonitorChart"
import { TraceMonitorStatsCard } from "./TraceMonitorStatsCard"
import {
  DEFAULT_INTERVAL_S,
  IntervalSlider,
  LastSampleSummary,
  PanelHeader,
  TakeOverButton,
  WipeHistoryButton,
} from "./TraceMonitorPanelParts"

const PUBKEY_RE = /^[0-9a-fA-F]{64}$/

export interface TraceMonitorPanelProps {
  /** 64-hex pubkey of the contact this panel is bound to. */
  pubkey: string
}

export function TraceMonitorPanel({ pubkey }: TraceMonitorPanelProps) {
  // Defence-in-depth: contact-detail already gates pubKey but a misuse
  // shouldn't fire mutations against an invalid target. Hooks below must
  // still run unconditionally to preserve hook ordering — we render `null`
  // at the bottom if the key is invalid.
  const validPubkey = PUBKEY_RE.test(pubkey)

  const statusQ = useTraceMonitorStatus()
  const sessionsQ = useTraceMonitorSessions(
    validPubkey ? { pubkey } : { pubkey: undefined },
  )
  const start = useStartTraceMonitor()
  const stop = useStopTraceMonitor()
  const del = useDeleteTraceMonitorSession()

  const status = statusQ.data
  const isRunning = !!status?.running
  const runningHere =
    isRunning && status?.target_pubkey?.toLowerCase() === pubkey.toLowerCase()
  const runningElsewhere = isRunning && !runningHere

  const historicalSessions = useMemo(
    () => sessionsQ.data?.items ?? [],
    [sessionsQ.data],
  )
  // Sessions are ordered DESC by `last_sample_at` on the backend, but we
  // sort defensively in case future API tweaks change that. Compare as
  // epoch ms so different ISO-8601 UTC-offset representations (`Z` vs
  // `+00:00`) collate consistently.
  const mostRecentHistorical = useMemo(() => {
    if (historicalSessions.length === 0) return null
    const sorted = [...historicalSessions].sort(
      (a, b) => Date.parse(b.last_sample_at) - Date.parse(a.last_sample_at),
    )
    return sorted[0]
  }, [historicalSessions])

  // Pick which session feeds the chart: active session wins, else most recent
  // historical for this contact, else nothing.
  const sessionIdForChart = runningHere
    ? status?.session_id ?? null
    : mostRecentHistorical?.session_id ?? null
  const samplesQ = useTraceMonitorSamples(sessionIdForChart)
  const samples = samplesQ.data ?? []

  const [intervalS, setIntervalS] = useState(DEFAULT_INTERVAL_S)
  const [showPerHop, setShowPerHop] = useState(false)

  const handleStart = () =>
    start.mutate({ pubkey, interval_s: intervalS })
  const handleStop = () => stop.mutate()
  const handleTakeOver = () =>
    start.mutate({ pubkey, interval_s: intervalS, force: true })
  const handleWipeHistory = async () => {
    // Delete every historical session for this contact in parallel. The hook
    // already toasts errors per-item; we use `allSettled` so a single
    // failure doesn't leave the rest of the batch un-deleted.
    await Promise.allSettled(
      historicalSessions.map((s) => del.mutateAsync(s.session_id)),
    )
  }

  const showWipe = historicalSessions.length > 0 && !runningHere

  if (!validPubkey) return null

  return (
    <Card>
      <PanelHeader
        runningHere={runningHere}
        runningElsewhere={runningElsewhere}
        startedAt={status?.started_at ?? null}
        samplesTotal={status?.samples_total ?? null}
      />
      <CardContent className="space-y-4">
        <IntervalSlider
          value={intervalS}
          onChange={setIntervalS}
          disabled={isRunning}
        />

        <div className="flex flex-wrap gap-2">
          {runningHere ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={handleStop}
              disabled={stop.isPending}
            >
              {stop.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Square className="mr-2 h-4 w-4" />
              )}
              Stop
            </Button>
          ) : runningElsewhere ? (
            <TakeOverButton
              onConfirm={handleTakeOver}
              pending={start.isPending}
              intervalS={intervalS}
            />
          ) : (
            <Button size="sm" onClick={handleStart} disabled={start.isPending}>
              {start.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Play className="mr-2 h-4 w-4" />
              )}
              Start
            </Button>
          )}
          {showWipe && (
            <WipeHistoryButton
              count={historicalSessions.length}
              onConfirm={handleWipeHistory}
              pending={del.isPending}
            />
          )}
        </div>

        <LastSampleSummary samples={samples} />

        {!runningHere && mostRecentHistorical && samples.length > 0 && (
          <div>
            <Badge variant="secondary">Showing last session</Badge>
          </div>
        )}

        <div className="flex items-center gap-2">
          <Switch
            id="trace-monitor-per-hop"
            checked={showPerHop}
            onCheckedChange={setShowPerHop}
            aria-label="Show per-hop SNR"
          />
          <Label htmlFor="trace-monitor-per-hop" className="text-sm">
            Show per-hop SNR
          </Label>
        </div>

        <TraceMonitorChart
          samples={samples}
          showPerHop={showPerHop}
          title="Trace SNR (rolling)"
        />

        <TraceMonitorStatsCard samples={samples} />
        <RecordingsList sessions={historicalSessions} />
      </CardContent>
    </Card>
  )
}
