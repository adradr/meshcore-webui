import { CheckCircle2, AlertTriangle, MinusCircle, Loader2, Play, Ban } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useLastDiagnostic, useLinkDiagnostic } from "./api"
import type { DiagnosticReport, StepResult, StepStatusValue } from "./types"

interface Props {
  pubkey: string
}

export function LinkDiagnosticPanel({ pubkey }: Props) {
  const last = useLastDiagnostic(pubkey)
  const run = useLinkDiagnostic(pubkey)
  // Mutation result wins over "last" (always fresher); fall back to the last
  // persisted run on a fresh page load.
  const report: DiagnosticReport | undefined = run.data ?? last.data

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">Link diagnostic</CardTitle>
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
      <VerdictBanner verdict={report.verdict} detail={report.verdict_detail} />
      <ol className="space-y-2">
        {report.steps.map((s) => (
          <li key={s.step} className="flex items-start gap-2 text-sm">
            <StepIcon status={s.status} />
            <div className="flex-1">
              <div className="font-medium">{prettyStepName(s.step)}</div>
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

function VerdictBanner({ verdict, detail }: { verdict: string; detail: string }) {
  // Healthy = subtle green; everything else = subtle amber. We don't paint
  // anything red because v1 verdicts are coarse — Phase 2 sharpens this.
  const cls =
    verdict === "healthy"
      ? "border-emerald-500/40 bg-emerald-500/10"
      : "border-amber-500/40 bg-amber-500/10"
  return (
    <div className={`rounded-md border ${cls} p-2`}>
      <div className="text-xs font-semibold uppercase tracking-wide">{verdict}</div>
      <div className="text-sm">{detail}</div>
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
function prettyStepName(step: string): string {
  return STEP_LABELS[step] ?? step
}
