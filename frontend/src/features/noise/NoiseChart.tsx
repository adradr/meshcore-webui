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

export interface NoiseChartProps {
  data: { t: number[]; y: number[] } // t = unix ms, y = noise floor dBm
  height?: number
  yLabel?: string
  title?: string
}

function readColorVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim()
  return v || fallback
}

export function NoiseChart({
  data,
  height = 200,
  yLabel = "Noise floor (dBm)",
  title = "Noise floor",
}: NoiseChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(600)
  const [themeTick, setThemeTick] = useState(0)

  // Track container width so uPlot can size its canvas correctly.
  useEffect(() => {
    if (!containerRef.current) return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 600
      if (w > 0) setWidth(Math.max(200, Math.floor(w)))
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [])

  // next-themes toggles `.dark` on <html>; re-read CSS vars on theme change.
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

  const opts: uPlot.Options = useMemo(() => {
    const lineColor = readColorVar("--chart-2", "rgb(100, 130, 200)")
    const gridColor = readColorVar("--border", "rgba(120,120,120,0.2)")
    const axisColor = readColorVar("--muted-foreground", "rgba(120,120,120,0.6)")
    return {
      width,
      height,
      scales: { x: { time: true } },
      series: [
        {},
        {
          label: yLabel,
          stroke: lineColor,
          width: 2,
          points: { show: false },
        },
      ],
      axes: [
        { stroke: axisColor, grid: { stroke: gridColor } },
        { stroke: axisColor, grid: { stroke: gridColor }, label: yLabel },
      ],
      legend: { show: false },
      cursor: { drag: { x: false, y: false } },
    }
    // themeTick is intentional - it forces re-read of CSS vars on theme toggle.
  }, [width, height, yLabel, themeTick])

  // uPlot expects timestamps in seconds (not ms) for default time formatting.
  const aligned: uPlot.AlignedData = useMemo(
    () => [data.t.map((t) => t / 1000), data.y],
    [data],
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div ref={containerRef} className="w-full">
          <UplotReact options={opts} data={aligned} />
        </div>
      </CardContent>
    </Card>
  )
}
