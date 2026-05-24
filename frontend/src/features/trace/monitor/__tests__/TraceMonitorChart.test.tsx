import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import type uPlot from "uplot"

import { type TraceSample } from "../api"
import { TraceMonitorChart } from "../TraceMonitorChart"

// uPlot needs a real canvas which JSDOM does not fully provide. We mock the
// React wrapper so we can assert on shell + data wiring without rendering
// pixels. The mock records the most recent `data` prop so tests can verify
// the aligned-data structure the component computes.
const lastUplotProps: { data: unknown; options: unknown } = {
  data: null,
  options: null,
}
vi.mock("uplot-react", () => ({
  default: (props: { data: unknown; options: unknown }) => {
    lastUplotProps.data = props.data
    lastUplotProps.options = props.options
    // Render a stub canvas so tests can detect presence of the chart body.
    return <canvas data-testid="uplot-canvas" />
  },
}))

function makeSample(overrides: Partial<TraceSample> = {}): TraceSample {
  return {
    session_id: "11111111-1111-1111-1111-111111111111",
    target_pubkey: "a".repeat(64),
    started_at: "2026-05-23T10:00:00Z",
    finished_at: "2026-05-23T10:00:01Z",
    status: "ok",
    path_len: 1,
    snr_there: 5,
    snr_back: 6,
    hops: [{ hash: "aa", snr: 4 }],
    error: null,
    ...overrides,
  }
}

describe("TraceMonitorChart", () => {
  it("renders empty state when given no samples", () => {
    render(<TraceMonitorChart samples={[]} title="Trace" />)
    expect(screen.getByText("Trace")).toBeInTheDocument()
    expect(screen.getByText(/waiting for first sample/i)).toBeInTheDocument()
    expect(screen.queryByTestId("uplot-canvas")).not.toBeInTheDocument()
  })

  it("renders chart canvas with three ok samples + failure rail column", () => {
    const samples: TraceSample[] = [
      makeSample({ finished_at: "2026-05-23T10:00:01Z", snr_there: 5, snr_back: 6 }),
      makeSample({ finished_at: "2026-05-23T10:00:02Z", snr_there: 4, snr_back: 7 }),
      makeSample({ finished_at: "2026-05-23T10:00:03Z", snr_there: 3, snr_back: 8 }),
    ]
    render(<TraceMonitorChart samples={samples} />)
    expect(screen.getByTestId("uplot-canvas")).toBeInTheDocument()
    const data = lastUplotProps.data as (number | null)[][]
    // [xs, snrThere, snrBack, failureRail] when showPerHop is false.
    expect(data).toHaveLength(4)
    expect(data[0]).toHaveLength(3)
    expect(data[1]).toEqual([5, 4, 3])
    expect(data[2]).toEqual([6, 7, 8])
    // All ok → no failure markers.
    expect(data[3]).toEqual([null, null, null])
  })

  it("re-renders without crashing when a new sample is appended", () => {
    const first: TraceSample[] = [makeSample()]
    const { rerender } = render(<TraceMonitorChart samples={first} />)
    expect(screen.getByTestId("uplot-canvas")).toBeInTheDocument()

    const second: TraceSample[] = [
      ...first,
      makeSample({ finished_at: "2026-05-23T10:00:05Z", snr_there: 2, snr_back: 3 }),
    ]
    rerender(<TraceMonitorChart samples={second} />)
    const data = lastUplotProps.data as number[][]
    expect(data[0]).toHaveLength(2)
  })

  it("emits nulls for failed samples on SNR series AND a rail marker on failures", () => {
    const samples: TraceSample[] = [
      makeSample({ finished_at: "2026-05-23T10:00:01Z", snr_there: 5, snr_back: 6 }),
      makeSample({
        finished_at: "2026-05-23T10:00:02Z",
        status: "timeout",
        snr_there: null,
        snr_back: null,
        hops: [],
        path_len: null,
        error: "timeout",
      }),
      makeSample({ finished_at: "2026-05-23T10:00:03Z", snr_there: 3, snr_back: 8 }),
    ]
    render(<TraceMonitorChart samples={samples} />)
    const data = lastUplotProps.data as (number | null)[][]
    expect(data[1]).toEqual([5, null, 3])
    expect(data[2]).toEqual([6, null, 8])
    // Failure rail: null for ok samples, fixed Y for failures. This is what
    // makes each timeout visually locatable on the time axis instead of
    // being a silent gap in the line.
    expect(data[3]).toEqual([null, -25, null])
  })

  it("renders the failure series with no line + visible red markers", () => {
    const samples: TraceSample[] = [
      makeSample({
        finished_at: "2026-05-23T10:00:01Z",
        status: "timeout",
        snr_there: null,
        snr_back: null,
        hops: [],
        path_len: null,
        error: "timeout",
      }),
      makeSample({ finished_at: "2026-05-23T10:00:02Z", snr_there: 4, snr_back: 5 }),
    ]
    render(<TraceMonitorChart samples={samples} />)
    const opts = lastUplotProps.options as uPlot.Options
    // series layout: [time, snrThere, snrBack, failures]
    expect(opts.series).toHaveLength(4)
    const failureSeries = opts.series![3] as uPlot.Series
    expect(String(failureSeries.label)).toBe("Failures")
    expect(failureSeries.width).toBe(0) // no line
    expect(failureSeries.points?.show).toBe(true)
  })

  it("renders SNR series with visible point markers (always-on dots)", () => {
    const samples: TraceSample[] = [
      makeSample({ finished_at: "2026-05-23T10:00:01Z", snr_there: 5, snr_back: 6 }),
    ]
    render(<TraceMonitorChart samples={samples} />)
    const opts = lastUplotProps.options as uPlot.Options
    const there = opts.series![1] as uPlot.Series
    const back = opts.series![2] as uPlot.Series
    expect(there.points?.show).toBe(true)
    expect(back.points?.show).toBe(true)
  })

  it("adds per-hop series in stable order when showPerHop is true", () => {
    const samples: TraceSample[] = [
      makeSample({
        finished_at: "2026-05-23T10:00:01Z",
        hops: [
          { hash: "aa", snr: 1 },
          { hash: "bb", snr: 2 },
        ],
      }),
      makeSample({
        finished_at: "2026-05-23T10:00:02Z",
        // "cc" appears second-in-time but should be column 3 by first-appearance order.
        hops: [
          { hash: "bb", snr: 4 },
          { hash: "cc", snr: 5 },
        ],
      }),
    ]
    render(<TraceMonitorChart samples={samples} showPerHop />)
    const data = lastUplotProps.data as (number | null)[][]
    // [xs, snrThere, snrBack, failureRail, hopAA, hopBB, hopCC]
    expect(data).toHaveLength(7)
    expect(data[4]).toEqual([1, null]) // aa - only first sample
    expect(data[5]).toEqual([2, 4]) // bb - both
    expect(data[6]).toEqual([null, 5]) // cc - only second

    // Lock the series-count invariant + hop-series styling.
    const opts = lastUplotProps.options as uPlot.Options
    // series layout: [time, snrThere, snrBack, failures, ...hopSeries]
    expect(opts.series).toHaveLength(4 + 3)
    const firstHopSeries = opts.series![4] as uPlot.Series
    expect(String(firstHopSeries.label)).toContain("hop ")
    expect(firstHopSeries.spanGaps).toBe(false)
    expect(firstHopSeries.points?.show).toBe(false)
  })

  it("renders all-timeouts breakdown instead of the chart when no sample is ok", () => {
    // Regression: previously the chart still rendered with all-null SNR
    // series, which uPlot then auto-ranged to [-1, 1] — the user read this
    // as "negative seconds". Now we surface the failure breakdown so the
    // root cause (bad link / wrong target) is obvious.
    const samples: TraceSample[] = [
      makeSample({
        finished_at: "2026-05-23T10:00:01Z",
        status: "timeout",
        snr_there: null,
        snr_back: null,
        hops: [],
        path_len: null,
        error: "timeout",
      }),
      makeSample({
        finished_at: "2026-05-23T10:00:02Z",
        status: "timeout",
        snr_there: null,
        snr_back: null,
        hops: [],
        path_len: null,
        error: "timeout",
      }),
      makeSample({
        finished_at: "2026-05-23T10:00:03Z",
        status: "unreachable",
        snr_there: null,
        snr_back: null,
        hops: [],
        path_len: null,
        error: "no path",
      }),
    ]
    render(<TraceMonitorChart samples={samples} />)
    expect(screen.queryByTestId("uplot-canvas")).not.toBeInTheDocument()
    expect(screen.getByText(/3 attempts, none successful/i)).toBeInTheDocument()
    expect(screen.getByText(/timeout/)).toBeInTheDocument()
    expect(screen.getByText(/unreachable/)).toBeInTheDocument()
  })

  it("emits null in hop columns for failed samples when showPerHop is true", () => {
    const samples: TraceSample[] = [
      makeSample({
        finished_at: "2026-05-23T10:00:01Z",
        hops: [{ hash: "aa", snr: 3 }],
      }),
      makeSample({
        finished_at: "2026-05-23T10:00:02Z",
        status: "timeout",
        snr_there: null,
        snr_back: null,
        hops: [],
        path_len: null,
        error: "timeout",
      }),
      makeSample({
        finished_at: "2026-05-23T10:00:03Z",
        hops: [{ hash: "aa", snr: 5 }],
      }),
    ]
    render(<TraceMonitorChart samples={samples} showPerHop />)
    const data = lastUplotProps.data as (number | null)[][]
    // [xs, snrThere, snrBack, failureRail, hopAA]
    expect(data).toHaveLength(5)
    expect(data[4]).toEqual([3, null, 5])
  })
})
