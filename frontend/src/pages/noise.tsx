import { useMemo, useState } from "react"
import { Activity } from "lucide-react"
import { useNoiseSamples } from "@/features/noise/api"
import { NoiseChart } from "@/features/noise/NoiseChart"
import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"

interface NoiseStats {
  current: number | null
  min: number | null
  max: number | null
  mean: number | null
}

function computeStats(
  samples: { noise_floor?: number | null }[],
): NoiseStats {
  const ys = samples
    .map((s) => s.noise_floor)
    .filter((v): v is number => v != null)
  if (ys.length === 0) {
    return { current: null, min: null, max: null, mean: null }
  }
  const current = ys[ys.length - 1]
  let min = ys[0]
  let max = ys[0]
  let sum = 0
  for (const v of ys) {
    if (v < min) min = v
    if (v > max) max = v
    sum += v
  }
  return { current, min, max, mean: sum / ys.length }
}

function Stat({
  label,
  value,
  suffix,
}: {
  label: string
  value: number | null
  suffix: string
}) {
  return (
    <div className="rounded-md border px-3 py-2 min-w-24">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-mono text-lg">
        {value === null ? "—" : `${value} ${suffix}`.trim()}
      </div>
    </div>
  )
}

export function NoisePage() {
  const [paused, setPaused] = useState(false)
  const { data, isLoading, isError } = useNoiseSamples({ paused })
  const samples = data ?? []

  const stats = useMemo(() => computeStats(samples), [samples])

  const t = useMemo(() => samples.map((s) => s.t_ms), [samples])
  const y = useMemo(
    () => samples.map((s) => s.noise_floor ?? 0),
    [samples],
  )

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">Noise floor</h1>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span>Pause</span>
          <Switch
            checked={paused}
            onCheckedChange={setPaused}
            aria-label="Pause stream"
          />
        </label>
      </header>

      <div className="flex flex-wrap gap-3 text-sm">
        <Stat label="Current" value={stats.current} suffix="dBm" />
        <Stat label="Min (5m)" value={stats.min} suffix="dBm" />
        <Stat label="Max (5m)" value={stats.max} suffix="dBm" />
        <MeanStat label="Mean (5m)" value={stats.mean} suffix="dBm" />
        <Stat label="Samples" value={samples.length} suffix="samples" />
      </div>

      <div className="min-h-0 flex-1">
        {isLoading ? (
          <Skeleton className="h-[min(600px,calc(100dvh-14rem))] w-full" />
        ) : isError ? (
          <div className="text-sm text-muted-foreground">
            Noise samples unavailable.
          </div>
        ) : (
          <div className="h-[min(600px,calc(100dvh-14rem))] w-full">
            <NoiseChart
              data={{ t, y }}
              title="Noise floor (rolling)"
              height={500}
            />
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Mean is displayed with one decimal so it never visually collides with the
 * Current value (which is typically an integer dBm reading).
 */
function MeanStat({
  label,
  value,
  suffix,
}: {
  label: string
  value: number | null
  suffix: string
}) {
  return (
    <div className="rounded-md border px-3 py-2 min-w-24">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-mono text-lg">
        {value === null ? "—" : `${value.toFixed(1)} ${suffix}`}
      </div>
    </div>
  )
}
