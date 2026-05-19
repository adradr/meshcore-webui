import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useNoiseSamples } from "./api"
import { NoiseChart } from "./NoiseChart"

function formatDbm(v: number | null | undefined): string {
  return v == null ? "—" : `${v} dBm`
}

/**
 * Realtime noise-floor widget. Renders a 5-minute window of samples plus a
 * small stats strip (current / min / max / count) above the chart.
 *
 * Handles three states: loading (skeleton), error (text fallback), and the
 * usual chart view. Used at the bottom of the /device page.
 */
export function NoiseWidget() {
  const { data, isLoading, isError } = useNoiseSamples()
  const samples = data ?? []

  // Limit to last 5 min for display.
  const cutoff = Date.now() - 5 * 60 * 1000
  const recent = samples.filter((s) => s.t_ms >= cutoff)

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Noise floor (last 5 min)</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-48 w-full" />
        </CardContent>
      </Card>
    )
  }

  if (isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Noise floor (last 5 min)</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Noise samples unavailable.
        </CardContent>
      </Card>
    )
  }

  const t = recent.map((s) => s.t_ms)
  const definedNoiseValues = recent
    .map((s) => s.noise_floor)
    .filter((v): v is number => v != null)

  const current = recent.at(-1)?.noise_floor ?? null
  const min =
    definedNoiseValues.length > 0 ? Math.min(...definedNoiseValues) : null
  const max =
    definedNoiseValues.length > 0 ? Math.max(...definedNoiseValues) : null

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <span>
          <span className="text-muted-foreground">Current:</span>{" "}
          <span className="font-mono">{formatDbm(current)}</span>
        </span>
        <span>
          <span className="text-muted-foreground">Min:</span>{" "}
          <span className="font-mono">{formatDbm(min)}</span>
        </span>
        <span>
          <span className="text-muted-foreground">Max:</span>{" "}
          <span className="font-mono">{formatDbm(max)}</span>
        </span>
        <span className="ml-auto text-muted-foreground">
          {recent.length} samples
        </span>
      </div>
      <NoiseChart
        data={{ t, y: recent.map((s) => s.noise_floor ?? 0) }}
        title="Noise floor (last 5 min)"
      />
    </div>
  )
}
