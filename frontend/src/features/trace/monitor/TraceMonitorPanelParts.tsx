/**
 * Presentational sub-components for ``TraceMonitorPanel``. Factored out to
 * keep the main panel file under the 400-LOC ceiling without sacrificing
 * readability. None of these own RF state — they all take primitive props
 * and delegate clicks back to the parent.
 */
import { useEffect, useState } from "react"
import { Loader2, ShieldAlert, Trash2 } from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"

import { type TraceSample } from "./api"

export const MIN_INTERVAL_S = 5
export const MAX_INTERVAL_S = 300
export const DEFAULT_INTERVAL_S = 10

// ---------------------------------------------------------------------------
// Header — title + status pill + started-at / sample-count meta.
// ---------------------------------------------------------------------------

interface PanelHeaderProps {
  runningHere: boolean
  runningElsewhere: boolean
  startedAt: string | null
  samplesTotal: number | null
}

export function PanelHeader({
  runningHere,
  runningElsewhere,
  startedAt,
  samplesTotal,
}: PanelHeaderProps) {
  let pill: { label: string; variant: "default" | "secondary" | "outline" }
  if (runningHere) {
    pill = { label: "● Running for THIS contact", variant: "default" }
  } else if (runningElsewhere) {
    pill = { label: "● Running elsewhere", variant: "secondary" }
  } else {
    pill = { label: "○ Idle", variant: "outline" }
  }

  const startedLocal = startedAt
    ? new Date(startedAt).toLocaleTimeString()
    : null

  return (
    <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
      <div>
        <CardTitle className="text-base">Continuous trace monitor</CardTitle>
        {(runningHere || runningElsewhere) && (
          <CardDescription>
            {startedLocal ? `Started ${startedLocal}` : null}
            {samplesTotal != null
              ? `${startedLocal ? " · " : ""}${samplesTotal} ticks`
              : null}
          </CardDescription>
        )}
      </div>
      <Badge variant={pill.variant} className="shrink-0">
        {pill.label}
      </Badge>
    </CardHeader>
  )
}

// ---------------------------------------------------------------------------
// Interval picker — big value readout + preset chips + slider for fine-tune.
//
// The bare shadcn slider made the cadence opaque ("what does the dot at 60%
// even mean?") and required precise dragging on mobile. The chips cover the
// realistic cadences operators want (5/10/30 s, 1/5 min) with a single tap;
// the slider stays for anything in between.
// ---------------------------------------------------------------------------

interface IntervalSliderProps {
  value: number
  onChange: (v: number) => void
  disabled: boolean
}

const INTERVAL_PRESETS: { label: string; seconds: number }[] = [
  { label: "5s", seconds: 5 },
  { label: "10s", seconds: 10 },
  { label: "30s", seconds: 30 },
  { label: "1m", seconds: 60 },
  { label: "5m", seconds: 300 },
]

function formatInterval(s: number): { value: string; unit: string } {
  if (s < 60) return { value: String(s), unit: "sec" }
  if (s % 60 === 0) return { value: String(s / 60), unit: s === 60 ? "min" : "min" }
  // Display mixed values as e.g. "1m 30s"
  const m = Math.floor(s / 60)
  const r = s % 60
  return { value: `${m}m ${r}s`, unit: "" }
}

export function IntervalSlider({
  value,
  onChange,
  disabled,
}: IntervalSliderProps) {
  const { value: vStr, unit } = formatInterval(value)
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <Label htmlFor="trace-monitor-interval" className="text-sm">
          Interval
        </Label>
        <div className="flex items-baseline gap-1">
          <span
            className="text-2xl font-semibold tabular-nums"
            aria-live="polite"
          >
            {vStr}
          </span>
          {unit && (
            <span className="text-sm text-muted-foreground">{unit}</span>
          )}
        </div>
      </div>

      <div
        role="radiogroup"
        aria-label="Trace monitor interval presets"
        className="flex flex-wrap gap-1.5"
      >
        {INTERVAL_PRESETS.map((p) => {
          const active = p.seconds === value
          return (
            <button
              type="button"
              key={p.seconds}
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => onChange(p.seconds)}
              className={`rounded-md border px-2.5 py-1 text-xs font-medium tabular-nums transition-colors ${
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-foreground hover:bg-muted"
              } disabled:cursor-not-allowed disabled:opacity-50`}
            >
              {p.label}
            </button>
          )
        })}
      </div>

      <Slider
        id="trace-monitor-interval"
        min={MIN_INTERVAL_S}
        max={MAX_INTERVAL_S}
        step={1}
        value={[value]}
        onValueChange={(v) => onChange(v[0] ?? value)}
        disabled={disabled}
        aria-label="Trace monitor interval (seconds)"
      />
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{MIN_INTERVAL_S}s</span>
        <span>{MAX_INTERVAL_S / 60} min</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Take-over confirmation
// ---------------------------------------------------------------------------

interface TakeOverButtonProps {
  // `onConfirm` may be sync OR async — `Promise<void>` keeps the contract
  // honest so callers can `await` mutations without a cast.
  onConfirm: () => void | Promise<void>
  pending: boolean
  /** Slider's current interval, displayed in the confirmation dialog so the
   *  operator sees what cadence the new session will lock in. */
  intervalS: number
}

export function TakeOverButton({
  onConfirm,
  pending,
  intervalS,
}: TakeOverButtonProps) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="default" disabled={pending}>
          {pending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <ShieldAlert className="mr-2 h-4 w-4" />
          )}
          Take over
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Take over the trace monitor?</AlertDialogTitle>
          <AlertDialogDescription>
            Another contact is currently being monitored. Taking over stops
            that session and starts a new one targeting this contact. The
            new session will use the current interval ({intervalS} s).
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            aria-label="Confirm take over"
          >
            Take over
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// ---------------------------------------------------------------------------
// Wipe-history confirmation
// ---------------------------------------------------------------------------

interface WipeHistoryButtonProps {
  count: number
  // Async-friendly — callers typically `await Promise.allSettled(...)` here.
  onConfirm: () => void | Promise<void>
  pending: boolean
}

export function WipeHistoryButton({
  count,
  onConfirm,
  pending,
}: WipeHistoryButtonProps) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="destructive" disabled={pending}>
          {pending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="mr-2 h-4 w-4" />
          )}
          Wipe history
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Wipe trace history?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes {count} historical session
            {count === 1 ? "" : "s"} for this contact. The currently active
            session, if any, is not affected.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            aria-label="Confirm wipe history"
          >
            Wipe
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// ---------------------------------------------------------------------------
// Last-sample one-liner — ticks once a second so "Xs ago" stays fresh.
// ---------------------------------------------------------------------------

interface LastSampleSummaryProps {
  samples: TraceSample[]
}

export function LastSampleSummary({ samples }: LastSampleSummaryProps) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(id)
  }, [])

  if (samples.length === 0) {
    return <p className="text-xs text-muted-foreground">No samples yet.</p>
  }
  const last = samples[samples.length - 1]
  const ago = formatAgo(now - Date.parse(last.finished_at))

  if (last.status !== "ok") {
    return (
      <p className="text-xs text-muted-foreground">
        Last: trace failed ({last.status}) {ago}
      </p>
    )
  }

  const there = last.snr_there != null ? `${last.snr_there} dB` : "—"
  const back = last.snr_back != null ? `${last.snr_back} dB` : "—"
  const hops = last.path_len ?? last.hops.length
  return (
    <p className="text-xs text-muted-foreground">
      Last: SNR there {there} · SNR back {back} · {hops} hops · {ago}
    </p>
  )
}

function formatAgo(deltaMs: number): string {
  // `Date.parse` returns NaN on a malformed ISO string; surface as "—"
  // rather than rendering "NaN s ago".
  if (!Number.isFinite(deltaMs)) return "—"
  const ms = Math.max(0, deltaMs)
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)} s ago`
  }
  if (ms < 3_600_000) {
    return `${Math.floor(ms / 60_000)}m ago`
  }
  return `${Math.floor(ms / 3_600_000)}h ago`
}
