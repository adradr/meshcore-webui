import * as React from "react"
import { ArrowRight, Loader2, Radio } from "lucide-react"
import {
  Area,
  AreaChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"

import { useLosCompute, type LosOut } from "./api"

export interface LineOfSightEndpoint {
  name: string
  lat: number
  lon: number
}

export interface LineOfSightModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The "self" / TX endpoint — usually the local device location */
  a: LineOfSightEndpoint | null
  /** The "target" / RX endpoint — usually a clicked map marker */
  b: LineOfSightEndpoint | null
}

const FREQ_OPTIONS = [
  { label: "868 MHz (EU)", value: 868_000_000 },
  { label: "915 MHz (US)", value: 915_000_000 },
  { label: "433 MHz (EU lower)", value: 433_000_000 },
] as const

const chartConfig = {
  ground: { label: "Terrain", color: "var(--chart-3)" },
  losTop: { label: "Line of sight", color: "var(--chart-1)" },
  fresnelBottom: { label: "Fresnel zone (60%)", color: "var(--chart-2)" },
} satisfies ChartConfig

interface ChartRow {
  distance_km: number
  ground_m: number
  los_h_m: number
  fresnel_lower_m: number
}

function buildChartData(out: LosOut, hTx: number, hRx: number): ChartRow[] {
  if (!out.samples.length) return []
  const first = out.samples[0]
  const last = out.samples[out.samples.length - 1]
  const txMsl = first.ground_m + hTx
  const rxMsl = last.ground_m + hRx
  const D = out.distance_m || 1
  return out.samples.map((s) => {
    const losH = txMsl + ((rxMsl - txMsl) * s.distance_m) / D
    return {
      distance_km: s.distance_m / 1000,
      ground_m: s.ground_m,
      los_h_m: losH,
      fresnel_lower_m: losH - 0.6 * s.fresnel_m,
    }
  })
}

function VerdictPill({ verdict }: { verdict: LosOut["verdict"] }) {
  if (verdict === "CLEAR") {
    return (
      <Badge className="bg-green-500 text-white hover:bg-green-500/90">
        CLEAR
      </Badge>
    )
  }
  if (verdict === "PARTIAL") {
    return (
      <Badge className="bg-yellow-500 text-black hover:bg-yellow-500/90">
        PARTIAL
      </Badge>
    )
  }
  return <Badge variant="destructive">BLOCKED</Badge>
}

function StatsStrip({ data }: { data: LosOut }) {
  const km = (data.distance_m / 1000).toFixed(2)
  const bearing = data.bearing_deg.toFixed(1)
  const clearance =
    data.min_clearance_ratio > 1000
      ? "∞"
      : `${(data.min_clearance_ratio * 100).toFixed(0)}%`
  return (
    <div className="flex flex-wrap gap-4 text-sm">
      <div>
        <div className="text-muted-foreground text-xs">Distance</div>
        <div className="font-medium">{km} km</div>
      </div>
      <div>
        <div className="text-muted-foreground text-xs">Bearing</div>
        <div className="font-medium">{bearing}°</div>
      </div>
      <div>
        <div className="text-muted-foreground text-xs">Min clearance</div>
        <div className="font-medium">{clearance}</div>
      </div>
    </div>
  )
}

function ResultPanel({
  data,
  hTx,
  hRx,
}: {
  data: LosOut
  hTx: number
  hRx: number
}) {
  const chartData = React.useMemo(
    () => buildChartData(data, hTx, hRx),
    [data, hTx, hRx],
  )
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <VerdictPill verdict={data.verdict} />
        <StatsStrip data={data} />
      </div>
      <ChartContainer config={chartConfig} className="h-64 w-full">
        <AreaChart data={chartData} accessibilityLayer>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey="distance_km"
            tickFormatter={(v: number) => `${v.toFixed(1)}km`}
          />
          <YAxis tickFormatter={(v: number) => `${Math.round(v)}m`} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Area
            dataKey="ground_m"
            fill="var(--color-ground)"
            stroke="var(--color-ground)"
            type="monotone"
          />
          <Area
            dataKey="fresnel_lower_m"
            stroke="var(--color-fresnelBottom)"
            fill="transparent"
            strokeDasharray="4 4"
            type="monotone"
          />
          <Area
            dataKey="los_h_m"
            stroke="var(--color-losTop)"
            fill="transparent"
            strokeWidth={2}
            type="monotone"
          />
        </AreaChart>
      </ChartContainer>
    </div>
  )
}

function PendingSkeleton() {
  return (
    <div className="flex flex-col gap-3" data-testid="los-pending">
      <div className="flex items-center gap-3">
        <Skeleton className="h-5 w-16" />
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-5 w-24" />
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  )
}

export function LineOfSightModal({
  open,
  onOpenChange,
  a,
  b,
}: LineOfSightModalProps) {
  const [hTx, setHTx] = React.useState(2)
  const [hRx, setHRx] = React.useState(2)
  const [freqHz, setFreqHz] = React.useState<number>(868_000_000)
  const mutation = useLosCompute()

  // Reset transient state when the modal closes so re-opening is clean.
  React.useEffect(() => {
    if (!open) {
      mutation.reset()
    }
    // We intentionally exclude mutation from deps — only react to open changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const canCompute = !!a && !!b && !mutation.isPending

  const handleCompute = () => {
    if (!a || !b) return
    mutation.mutate({
      a: { lat: a.lat, lon: a.lon, height_m: hTx },
      b: { lat: b.lat, lon: b.lon, height_m: hRx },
      freq_hz: freqHz,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-1.5">
            <Radio className="size-4" />
            <span>Line of sight:</span>
            <span className="font-semibold">{a?.name ?? "—"}</span>
            <ArrowRight className="size-3.5" />
            <span className="font-semibold">{b?.name ?? "—"}</span>
          </DialogTitle>
          <DialogDescription>
            Sample terrain between the two points, calculate Fresnel zone
            clearance, and verdict link viability.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="los-h-tx">TX antenna height (m)</Label>
              <Input
                id="los-h-tx"
                type="number"
                step="0.5"
                min="0"
                max="200"
                value={hTx}
                onChange={(e) => setHTx(Number(e.target.value))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="los-h-rx">RX antenna height (m)</Label>
              <Input
                id="los-h-rx"
                type="number"
                step="0.5"
                min="0"
                max="200"
                value={hRx}
                onChange={(e) => setHRx(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="los-freq">Frequency</Label>
            <select
              id="los-freq"
              value={freqHz}
              onChange={(e) => setFreqHz(Number(e.target.value))}
              className="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
            >
              {FREQ_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <Button onClick={handleCompute} disabled={!canCompute}>
              {mutation.isPending ? (
                <>
                  <Loader2 className="animate-spin" />
                  Computing…
                </>
              ) : (
                "Compute"
              )}
            </Button>
          </div>

          {mutation.isPending && <PendingSkeleton />}
          {mutation.data && !mutation.isPending && (
            <ResultPanel data={mutation.data} hTx={hTx} hRx={hRx} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
