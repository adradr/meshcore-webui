/**
 * TraceMonitorChart — multi-series uPlot view for the continuous trace monitor.
 *
 * Renders SNR-there + SNR-back over time, with an optional per-hop SNR overlay.
 * Pure presentation: the parent fetches and supplies the rolling sample buffer.
 *
 * Mirrors the layout patterns in ``features/noise/NoiseChart.tsx`` (responsive
 * ResizeObserver, theme-aware CSS-var colours, uPlot seconds-time-axis,
 * Card shell). Duplicates ``readColorVar`` inline rather than extracting a
 * util — only two callers today.
 */
import { useEffect, useMemo, useRef, useState } from "react"
import UplotReact from "uplot-react"
import type uPlot from "uplot"
import "uplot/dist/uPlot.min.css"

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

import { type TraceSample } from "./api"

export interface TraceMonitorChartProps {
  samples: TraceSample[]
  height?: number
  showPerHop?: boolean
  title?: string
}

// Fallback palette for per-hop series when --chart-N vars are absent or for
// hops past the first two; chosen as evenly-spaced hues for stable visual
// separation between traces.
const HOP_FALLBACK_PALETTE = [
  "hsl(180 60% 50%)",
  "hsl(240 60% 50%)",
  "hsl(300 60% 50%)",
  "hsl(30 70% 50%)",
  "hsl(90 60% 45%)",
  "hsl(330 65% 55%)",
]

function readColorVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim()
  return v || fallback
}

interface HopColumns {
  hashes: string[] // first-appearance order
  data: (number | null)[][] // one array per hash, aligned to xs
}

/**
 * Build per-hop data columns in first-appearance order so colour-per-hop stays
 * stable as new hops appear. ``status`` checking is the caller's job — failed
 * samples already carry ``hops: []`` from the persistence layer, so they
 * naturally emit ``null`` for every hop column.
 */
function buildHopColumns(samples: TraceSample[]): HopColumns {
  const hashes: string[] = []
  const seen = new Set<string>()
  for (const s of samples) {
    if (s.status !== "ok") continue
    for (const h of s.hops) {
      if (!seen.has(h.hash)) {
        seen.add(h.hash)
        hashes.push(h.hash)
      }
    }
  }
  const data: (number | null)[][] = hashes.map(() => new Array(samples.length).fill(null))
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]
    if (s.status !== "ok") continue
    for (const h of s.hops) {
      const col = hashes.indexOf(h.hash)
      if (col >= 0) data[col][i] = h.snr
    }
  }
  return { hashes, data }
}

export function TraceMonitorChart({
  samples,
  height = 300,
  showPerHop = false,
  title = "Trace SNR (rolling)",
}: TraceMonitorChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(600)
  const [themeTick, setThemeTick] = useState(0)

  useEffect(() => {
    if (!containerRef.current) return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 600
      if (w > 0) setWidth(Math.max(200, Math.floor(w)))
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (typeof window === "undefined" || typeof MutationObserver === "undefined")
      return
    const mo = new MutationObserver(() => setThemeTick((t) => t + 1))
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    })
    return () => mo.disconnect()
  }, [])

  // Hops are derived once per samples change; the chart options pick this up
  // by reference for series styling.
  const hopColumns = useMemo(
    () => (showPerHop ? buildHopColumns(samples) : { hashes: [], data: [] }),
    [samples, showPerHop],
  )

  const aligned: uPlot.AlignedData = useMemo(() => {
    const xs = samples.map((s) => Date.parse(s.finished_at) / 1000)
    const snrThere = samples.map((s) =>
      s.status === "ok" ? s.snr_there : null,
    )
    const snrBack = samples.map((s) =>
      s.status === "ok" ? s.snr_back : null,
    )
    return [xs, snrThere, snrBack, ...hopColumns.data] as uPlot.AlignedData
  }, [samples, hopColumns])

  const opts: uPlot.Options = useMemo(() => {
    const thereColor = readColorVar("--chart-2", "rgb(100, 130, 200)")
    const backColor = readColorVar("--chart-3", "rgb(200, 130, 100)")
    const gridColor = readColorVar("--border", "rgba(120,120,120,0.2)")
    const axisColor = readColorVar(
      "--muted-foreground",
      "rgba(120,120,120,0.6)",
    )

    const hopSeries: uPlot.Series[] = hopColumns.hashes.map((hash, idx) => {
      const themed =
        idx === 0
          ? readColorVar("--chart-4", HOP_FALLBACK_PALETTE[0])
          : idx === 1
            ? readColorVar("--chart-5", HOP_FALLBACK_PALETTE[1])
            : HOP_FALLBACK_PALETTE[idx % HOP_FALLBACK_PALETTE.length]
      return {
        label: `hop ${hash.slice(0, 6)}`,
        stroke: themed,
        width: 1,
        points: { show: false },
        spanGaps: false,
      }
    })

    return {
      width,
      height,
      scales: { x: { time: true } },
      series: [
        {},
        {
          label: "SNR there",
          stroke: thereColor,
          width: 2,
          points: { show: false },
          spanGaps: false,
        },
        {
          label: "SNR back",
          stroke: backColor,
          width: 2,
          points: { show: false },
          spanGaps: false,
        },
        ...hopSeries,
      ],
      axes: [
        { stroke: axisColor, grid: { stroke: gridColor } },
        {
          stroke: axisColor,
          grid: { stroke: gridColor },
          label: "SNR (dB)",
        },
      ],
      legend: { show: true },
      cursor: { drag: { x: false, y: false } },
    }
    // themeTick is intentional - it forces re-read of CSS vars on theme toggle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, hopColumns, themeTick])

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div ref={containerRef} className="w-full">
          {samples.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Waiting for first sample…
            </p>
          ) : (
            <UplotReact options={opts} data={aligned} />
          )}
        </div>
      </CardContent>
    </Card>
  )
}
