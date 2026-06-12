import { CheckCircle2, AlertTriangle, MinusCircle, Loader2, Play, Ban } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { useLastDiagnostic, useLinkDiagnostic } from "./api"
import type { DiagnosticReport, StepResult, StepStatusValue } from "./types"

interface Props {
  pubkey: string
}

const HEADER_DESCRIPTION =
  "Runs an end-to-end RF probe between your radio and this contact. " +
  "Each step exercises a different part of the link so you can see exactly where it's weak."

export function LinkDiagnosticPanel({ pubkey }: Props) {
  const last = useLastDiagnostic(pubkey)
  const run = useLinkDiagnostic(pubkey)
  // Mutation result wins over "last" (always fresher); fall back to the last
  // persisted run on a fresh page load.
  const report: DiagnosticReport | undefined = run.data ?? last.data

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-row items-start justify-between gap-2">
          <div className="space-y-1.5">
            <CardTitle className="text-base">Link diagnostic</CardTitle>
            <CardDescription>{HEADER_DESCRIPTION}</CardDescription>
          </div>
          <Button
            size="sm"
            onClick={() => run.mutate({})}
            disabled={run.isPending}
            aria-label="Run link diagnostic"
          >
            {run.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Play className="mr-2 h-4 w-4" />
            )}
            {run.isPending ? "Running…" : report ? "Re-run" : "Run"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {!report ? <EmptyState loading={last.isLoading} /> : <ReportView report={report} />}
      </CardContent>
    </Card>
  )
}

function EmptyState({ loading }: { loading: boolean }) {
  if (loading) {
    return <p className="text-xs text-muted-foreground">Checking for previous runs…</p>
  }
  return (
    <p className="text-xs text-muted-foreground">
      No diagnostic recorded for this contact yet. Click <strong>Run</strong> to start.
    </p>
  )
}

function ReportView({ report }: { report: DiagnosticReport }) {
  return (
    <div className="space-y-3">
      <VerdictCard report={report} />
      <ol className="space-y-3">
        {report.steps.map((s) => (
          <li key={s.step} className="flex items-start gap-2 text-sm">
            <StepIcon status={s.status} />
            <div className="flex-1 space-y-0.5">
              <div className="flex items-center justify-between gap-2">
                <div className="font-medium">{prettyStepName(s.step)}</div>
                <StatusChip status={s.status} />
              </div>
              <div className="text-xs text-muted-foreground">
                {STEP_DESCRIPTIONS[s.step] ?? ""}
              </div>
              <StepDetail step={s} />
            </div>
          </li>
        ))}
      </ol>
      <p className="text-[10px] text-muted-foreground">
        Ran {new Date(report.finished_at).toLocaleString()}.
      </p>
    </div>
  )
}

type VerdictTier = "HEALTHY" | "DEGRADED" | "UNREACHABLE"

// eslint-disable-next-line react-refresh/only-export-components
export function verdictTier(report: DiagnosticReport): VerdictTier {
  if (report.verdict === "healthy") return "HEALTHY"

  const attempted = report.steps.filter(
    (s) => s.status === "responded" || s.status === "no_response",
  )
  const responded = attempted.filter((s) => s.status === "responded")
  const noResponse = attempted.filter((s) => s.status === "no_response")

  // All attempted steps failed (and at least one was attempted) → unreachable.
  if (attempted.length > 0 && responded.length === 0) return "UNREACHABLE"

  // Mixed responses → degraded.
  if (responded.length > 0 && noResponse.length > 0) return "DEGRADED"

  return "DEGRADED"
}

const TIER_CLASSES: Record<VerdictTier, string> = {
  HEALTHY: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  DEGRADED: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  UNREACHABLE: "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-400",
}

function VerdictCard({ report }: { report: DiagnosticReport }) {
  const tier = verdictTier(report)
  const responded = report.steps.filter((s) => s.status === "responded").length
  const total = report.steps.length
  return (
    <div
      className={`rounded-md border p-3 ${TIER_CLASSES[tier]}`}
      data-testid="verdict-card"
      data-tier={tier}
    >
      <div className="text-xs font-semibold uppercase tracking-wide">{tier}</div>
      <div className="text-sm text-foreground">{report.verdict_detail}</div>
      <div className="mt-1 text-xs text-muted-foreground">
        {responded} of {total} steps responded
      </div>
    </div>
  )
}

function StepIcon({ status }: { status: StepStatusValue }) {
  switch (status) {
    case "responded":
      return <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-500" aria-label="responded" />
    case "no_response":
      return <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-500" aria-label="no response" />
    case "skipped":
      return <Ban className="mt-0.5 h-4 w-4 text-muted-foreground" aria-label="skipped" />
    default:
      return <MinusCircle className="mt-0.5 h-4 w-4 text-muted-foreground" aria-label="not attempted" />
  }
}

const CHIP_LABEL: Record<StepStatusValue, string> = {
  responded: "responded",
  no_response: "no response",
  skipped: "skipped",
  not_attempted: "not attempted",
}

const CHIP_CLASSES: Record<StepStatusValue, string> = {
  responded:
    "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  no_response:
    "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  skipped:
    "border-muted bg-muted/40 text-muted-foreground",
  not_attempted:
    "border-muted bg-muted/20 text-muted-foreground",
}

function StatusChip({ status }: { status: StepStatusValue }) {
  return (
    <Badge variant="outline" className={CHIP_CLASSES[status]}>
      {CHIP_LABEL[status]}
    </Badge>
  )
}

function StepDetail({ step }: { step: StepResult }) {
  if (step.status === "responded") {
    // Phase 1 data is a flat dict of numbers / strings. Render a compact
    // key=value summary so radio users can read it. Phase 2 will render
    // properly per step type.
    const entries = Object.entries(step.data ?? {})
    if (entries.length === 0) {
      return <span className="text-xs text-muted-foreground">OK</span>
    }
    return (
      <span className="text-xs text-muted-foreground">
        {entries
          .slice(0, 4)
          .map(([k, v]) => `${k}=${v}`)
          .join(" · ")}
        {entries.length > 4 ? " …" : ""}
      </span>
    )
  }
  if (step.status === "no_response") {
    return (
      <span className="text-xs text-muted-foreground">
        {step.error ?? "No reply."}
      </span>
    )
  }
  if (step.status === "skipped") {
    return (
      <span className="text-xs text-muted-foreground">
        {step.skip_reason ?? "Skipped."}
      </span>
    )
  }
  return <span className="text-xs text-muted-foreground">Not attempted.</span>
}

const STEP_LABELS: Record<string, string> = {
  local_stats_radio: "Local radio stats",
  local_stats_core: "Local core stats",
  local_stats_packets: "Local packet counters",
  ping: "Ping",
  telemetry: "Telemetry",
  stored_path: "Stored path",
  reception: "Reception from peer",
  trace: "Trace",
  path_discovery: "Path discovery",
  remote_neighbours: "Remote neighbour list",
}

const STEP_DESCRIPTIONS: Record<string, string> = {
  local_stats_radio:
    "Noise floor, last RSSI / SNR, packet timings — your radio's own health snapshot.",
  local_stats_core: "Firmware uptime, CPU / memory, queue depth.",
  local_stats_packets: "Tx / Rx / dropped packets since boot.",
  ping: "Round-trip echo: did this contact respond at all, and how long did it take?",
  telemetry: "Last telemetry payload (battery, sensors, etc.) the contact reported.",
  stored_path: "The repeater chain your radio currently uses to reach this contact.",
  reception: "Most recent advert / message the contact sent us, with its RSSI / SNR.",
  trace: "Sends a TRACE packet along the stored path and reads back per-hop SNR.",
  path_discovery: "Re-runs path discovery to find a better route.",
  remote_neighbours:
    "Asks this contact who IT can hear — useful for triangulating link asymmetry.",
}

function prettyStepName(step: string): string {
  return STEP_LABELS[step] ?? step
}
