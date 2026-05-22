import { describe, expect, it } from "vitest"
import { formatLastSeen, relativeTime } from "../format"
import { isPlausibleSeconds } from "@/lib/timestamps"

// Fixed reference time well inside the plausibility window
// (post-2020, not future-dated) so timestamps derived from it are sane.
const NOW = Date.UTC(2026, 4, 22) // ms — 2026-05-22 UTC

describe("relativeTime — plausibility short-circuit", () => {
  it("renders '—' for negative last-heard", () => {
    expect(relativeTime(-1, NOW)).toBe("—")
  })

  it("renders '—' for pre-2020 timestamps", () => {
    expect(relativeTime(100, NOW)).toBe("—")
  })

  it("renders '—' for future-dated values (>1h ahead)", () => {
    expect(relativeTime(NOW / 1000 + 7200, NOW)).toBe("—")
  })

  it("still renders sane relative time for normal values", () => {
    expect(relativeTime(NOW / 1000 - 30, NOW)).toBe("30s ago")
  })

  it("accepts values up to the future-grace ceiling", () => {
    // 1800s ahead is well inside FUTURE_GRACE_S=3600.
    expect(relativeTime(NOW / 1000 + 1800, NOW)).toBe("now")
  })
})

describe("formatLastSeen", () => {
  it("returns null for missing / zero", () => {
    expect(formatLastSeen(null, NOW)).toBeNull()
    expect(formatLastSeen(undefined, NOW)).toBeNull()
    expect(formatLastSeen(0, NOW)).toBeNull()
  })

  it("returns null for implausible (pre-2020) values", () => {
    expect(formatLastSeen(-1, NOW)).toBeNull()
    expect(formatLastSeen(100, NOW)).toBeNull()
  })

  it("returns null for far-future values", () => {
    expect(formatLastSeen(NOW / 1000 + 7200, NOW)).toBeNull()
  })

  it("returns a human relative-time string for plausible values", () => {
    expect(formatLastSeen(NOW / 1000 - 30, NOW)).toBe("30s ago")
    expect(formatLastSeen(NOW / 1000 - 3700, NOW)).toBe("1h 1m ago")
  })
})

describe("isPlausibleSeconds", () => {
  it("rejects null / undefined / zero / negative / pre-2020", () => {
    expect(isPlausibleSeconds(null, NOW)).toBe(false)
    expect(isPlausibleSeconds(undefined, NOW)).toBe(false)
    expect(isPlausibleSeconds(0, NOW)).toBe(false)
    expect(isPlausibleSeconds(-1, NOW)).toBe(false)
    expect(isPlausibleSeconds(100, NOW)).toBe(false)
  })

  it("rejects values beyond the future grace window", () => {
    expect(isPlausibleSeconds(NOW / 1000 + 7200, NOW)).toBe(false)
  })

  it("accepts plausible recent values", () => {
    expect(isPlausibleSeconds(NOW / 1000 - 30, NOW)).toBe(true)
    expect(isPlausibleSeconds(NOW / 1000 + 1800, NOW)).toBe(true)
  })
})
