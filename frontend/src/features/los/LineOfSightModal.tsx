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
import { useSelfInfo } from "@/features/device/queries"

import { useLosCompute, type LosOut } from "./api"

/** LoRa EU default — used silently when the device hasn't reported its freq yet. */
const DEFAULT_FREQ_HZ = 868_000_000

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
      <ChartContainer config={chartConfig} className="aspect-auto h-64 w-full min-w-0">
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
  // Pull the operating frequency from the device itself — no user picker.
  // Fall back silently to the EU default if the device hasn't reported yet
  // (or the call errored), so the modal still works offline-ish.
  const { data: selfInfo } = useSelfInfo()
  const radioFreqMHz = selfInfo?.radio_freq
  const freqHz =
    typeof radioFreqMHz === "number" && Number.isFinite(radioFreqMHz)
      ? Math.round(radioFreqMHz * 1e6)
      : DEFAULT_FREQ_HZ
  const hasDeviceFreq = typeof radioFreqMHz === "number" && Number.isFinite(radioFreqMHz)
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
      {/*
        On mobile the default centered DialogContent (`top-1/2 -translate-y-1/2`)
        gets pushed off-screen when the virtual keyboard appears: the visual
        viewport shrinks but the centered transform still references the layout
        viewport. Anchor to the top on small screens so inputs stay above the
        keyboard.
      */}
      <DialogContent
        className="top-4 max-h-[calc(100dvh-2rem)] translate-y-0 overflow-y-auto sm:top-1/2 sm:max-w-2xl sm:-translate-y-1/2"
      >
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-x-1.5 gap-y-1 break-words">
            <Radio className="size-4 shrink-0" />
            <span>Line of sight:</span>
            <span className="min-w-0 break-words font-semibold">
              {a?.name ?? "—"}
            </span>
            <ArrowRight className="size-3.5 shrink-0" />
            <span className="min-w-0 break-words font-semibold">
              {b?.name ?? "—"}
            </span>
          </DialogTitle>
          <DialogDescription>
            Sample terrain between the two points, calculate Fresnel zone
            clearance, and verdict link viability.
          </DialogDescription>
          {hasDeviceFreq && (
            <p className="text-xs text-muted-foreground">
              Frequency: {radioFreqMHz!.toFixed(1)} MHz (auto)
            </p>
          )}
        </DialogHeader>

        {/*
          Wrap inputs in a real <form> so the on-screen keyboard's submit
          (Go / Done) key triggers Compute. The Button is type="submit" and
          handleCompute is invoked via onSubmit (with preventDefault to keep
          the page from reloading).
        */}
        <form
          className="flex min-w-0 flex-col gap-4 overflow-x-hidden"
          onSubmit={(e) => {
            e.preventDefault()
            if (canCompute) handleCompute()
          }}
        >
          {/* Side-by-side on every viewport — saves a row and matches the */}
          {/* TX / RX mental pairing. Narrowest mobile (320px) still fits. */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor="los-h-tx">TX height (m)</Label>
              <Input
                id="los-h-tx"
                type="number"
                inputMode="decimal"
                enterKeyHint="send"
                step="0.5"
                min="0"
                max="200"
                value={hTx}
                onChange={(e) => setHTx(Number(e.target.value))}
              />
            </div>
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor="los-h-rx">RX height (m)</Label>
              <Input
                id="los-h-rx"
                type="number"
                inputMode="decimal"
                enterKeyHint="send"
                step="0.5"
                min="0"
                max="200"
                value={hRx}
                onChange={(e) => setHRx(Number(e.target.value))}
              />
            </div>
          </div>

          <div>
            <Button type="submit" disabled={!canCompute}>
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
        </form>
      </DialogContent>
    </Dialog>
  )
}
