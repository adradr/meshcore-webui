import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import type { TraceSample } from "../api"
import { TraceMonitorStatsCard } from "../TraceMonitorStatsCard"

function makeSample(o: Partial<TraceSample> = {}): TraceSample {
  return {
    session_id: "s", target_pubkey: "ab".repeat(32),
    started_at: "2026-05-24T15:00:00+00:00",
    finished_at: "2026-05-24T15:00:01+00:00",
    status: "ok", path_len: 1, snr_there: 5, snr_back: 6,
    hops: [{ hash: "aa", snr: 5 }], error: null,
    ...o,
  }
}

describe("TraceMonitorStatsCard", () => {
  it("renders nothing when there are no samples (panel handles empty state)", () => {
    const { container } = render(<TraceMonitorStatsCard samples={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it("renders snr-there / snr-back min/max/avg/median/p95 + success rate + path stability", () => {
    render(
      <TraceMonitorStatsCard
        samples={[
          makeSample({ snr_there: 5, snr_back: 6 }),
          makeSample({ snr_there: 1, snr_back: 2, status: "timeout", hops: [] }),
          makeSample({ snr_there: 3, snr_back: 8 }),
        ]}
      />,
    )
    expect(screen.getByText(/success rate/i)).toBeInTheDocument()
    expect(screen.getByText(/67%/)).toBeInTheDocument()
    expect(screen.getByText(/SNR there/i)).toBeInTheDocument()
    expect(screen.getByText(/SNR back/i)).toBeInTheDocument()
    expect(screen.getByText(/Path stability/i)).toBeInTheDocument()
  })
})
