import { describe, expect, it } from "vitest"
import type { TraceSample } from "../api"
import { computeStats, computePathStability } from "../stats"

function sample(o: Partial<TraceSample> = {}): TraceSample {
  return {
    session_id: "s",
    target_pubkey: "ab".repeat(32),
    started_at: "2026-05-24T15:00:00+00:00",
    finished_at: "2026-05-24T15:00:01+00:00",
    status: "ok",
    path_len: 1,
    snr_there: 0,
    snr_back: 0,
    hops: [{ hash: "aa", snr: 0 }],
    error: null,
    ...o,
  }
}

describe("computeStats", () => {
  it("returns null block when there are zero ok samples", () => {
    expect(computeStats([])).toEqual({
      ok: 0, total: 0, successRate: 0,
      snrThere: null, snrBack: null,
      statusBreakdown: {},
    })
  })

  it("computes min/max/avg/median/p95 over snr_there + snr_back, only ok samples", () => {
    const samples = [
      sample({ snr_there: 5, snr_back: 6 }),
      sample({ snr_there: 1, snr_back: 2, status: "timeout" }), // ignored
      sample({ snr_there: 3, snr_back: 8 }),
      sample({ snr_there: 9, snr_back: 4 }),
      sample({ snr_there: 7, snr_back: 5 }),
    ]
    const s = computeStats(samples)
    expect(s.ok).toBe(4)
    expect(s.total).toBe(5)
    expect(s.successRate).toBeCloseTo(0.8, 3)
    // snrThere over [5, 3, 9, 7]: min=3, max=9, avg=6, median=6, p95=8.7
    expect(s.snrThere!.min).toBe(3)
    expect(s.snrThere!.max).toBe(9)
    expect(s.snrThere!.avg).toBeCloseTo(6, 3)
    expect(s.snrThere!.median).toBeCloseTo(6, 3)
    expect(s.snrThere!.p95).toBeGreaterThanOrEqual(8)
    expect(s.snrThere!.p95).toBeLessThanOrEqual(9)
    // statusBreakdown counts non-ok
    expect(s.statusBreakdown).toEqual({ timeout: 1 })
  })

  it("returns snrThere=null when every ok sample has snr_there=null", () => {
    const samples = [
      sample({ snr_there: null }),
      sample({ snr_there: null }),
    ]
    const s = computeStats(samples)
    expect(s.snrThere).toBeNull()
    expect(s.ok).toBe(2)
  })

  it("handles negative SNR values correctly (LoRa working range is often negative)", () => {
    const samples = [
      sample({ snr_there: -3, snr_back: -8 }),
      sample({ snr_there: -10, snr_back: -12 }),
      sample({ snr_there: -1, snr_back: -2 }),
    ]
    const s = computeStats(samples)
    expect(s.snrThere!.min).toBe(-10)
    expect(s.snrThere!.max).toBe(-1)
    expect(s.snrThere!.avg).toBeCloseTo(-14 / 3, 3)
  })
})

describe("computePathStability", () => {
  it("returns 1.0 when every ok sample has the same hop-hash sequence", () => {
    const same = (h: { hash: string; snr: number }[]) => sample({ hops: h })
    const samples = [
      same([{ hash: "aa", snr: 1 }, { hash: "bb", snr: 2 }]),
      same([{ hash: "aa", snr: 3 }, { hash: "bb", snr: 4 }]),
      same([{ hash: "aa", snr: 5 }, { hash: "bb", snr: 6 }]),
    ]
    expect(computePathStability(samples)).toBe(1)
  })

  it("returns the fraction of ok samples whose path matches the modal path", () => {
    const samples = [
      sample({ hops: [{ hash: "aa", snr: 1 }, { hash: "bb", snr: 2 }] }),
      sample({ hops: [{ hash: "aa", snr: 3 }, { hash: "bb", snr: 4 }] }),
      sample({ hops: [{ hash: "cc", snr: 5 }, { hash: "bb", snr: 6 }] }), // different
    ]
    expect(computePathStability(samples)).toBeCloseTo(2 / 3, 3)
  })

  it("returns null when there are no ok samples", () => {
    expect(computePathStability([sample({ status: "timeout", hops: [] })])).toBe(
      null,
    )
  })
})
