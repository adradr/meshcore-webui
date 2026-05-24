/**
 * Pure helpers — rolling-window statistics over an in-memory buffer of
 * ``TraceSample`` rows (the same buffer the chart already consumes).
 *
 * Kept dependency-free and side-effect-free so the StatsCard can be a thin
 * presentational shell over these results. Every computation walks the input
 * once or twice — fine for the 600-sample client buffer cap enforced in
 * ``api.ts`` (MAX_CLIENT_BUFFER).
 */
import type { TraceSample } from "./api"

export interface SnrStats {
  min: number
  max: number
  avg: number
  median: number
  p95: number
}

export interface Stats {
  total: number
  ok: number
  successRate: number
  snrThere: SnrStats | null
  snrBack: SnrStats | null
  statusBreakdown: Record<string, number>
}

/**
 * Linear-interpolated percentile (numpy / Excel "linear" method) over an
 * already-ascending-sorted numeric array. Returns the sole value for
 * single-element inputs.
 */
function percentile(sorted: number[], q: number): number {
  if (sorted.length === 1) return sorted[0]
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

/**
 * Returns ``null`` when the input has zero finite values so callers can render
 * a "—" placeholder without scattering null-checks across the UI.
 */
function snrStats(values: (number | null)[]): SnrStats | null {
  const arr = values
    .filter((v): v is number => v != null && !Number.isNaN(v))
    .sort((a, b) => a - b)
  if (arr.length === 0) return null
  return {
    min: arr[0],
    max: arr[arr.length - 1],
    avg: arr.reduce((a, b) => a + b, 0) / arr.length,
    median: percentile(arr, 0.5),
    p95: percentile(arr, 0.95),
  }
}

/**
 * Computes the rolling-window statistics. ``snrThere`` / ``snrBack`` are only
 * aggregated over ``status === "ok"`` samples; ``statusBreakdown`` counts
 * every non-ok status so the UI can render "× N timeout" chips.
 */
export function computeStats(samples: TraceSample[]): Stats {
  const ok = samples.filter((s) => s.status === "ok")
  const breakdown: Record<string, number> = {}
  for (const s of samples) {
    if (s.status === "ok") continue
    breakdown[s.status] = (breakdown[s.status] ?? 0) + 1
  }
  return {
    total: samples.length,
    ok: ok.length,
    successRate: samples.length === 0 ? 0 : ok.length / samples.length,
    snrThere: snrStats(ok.map((s) => s.snr_there)),
    snrBack: snrStats(ok.map((s) => s.snr_back)),
    statusBreakdown: breakdown,
  }
}

/**
 * Path stability — the fraction of ok samples whose hop-hash sequence matches
 * the modal (most common) path. ``1.0`` means every ok sample takes the same
 * route; ``null`` when there's nothing to compute. The path key is the
 * concatenated hop hashes — order matters, so a reverse route hashes
 * differently (intentional: an asymmetric route is not "the same path").
 */
export function computePathStability(samples: TraceSample[]): number | null {
  const ok = samples.filter((s) => s.status === "ok")
  if (ok.length === 0) return null
  const counts = new Map<string, number>()
  for (const s of ok) {
    const key = s.hops.map((h) => h.hash).join("|")
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  let modal = 0
  for (const v of counts.values()) if (v > modal) modal = v
  return modal / ok.length
}
