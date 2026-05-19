import { describe, expect, it } from "vitest"
import { bearingDeg, compassDir, formatDistance, haversineKm } from "@/lib/geo"

describe("haversineKm", () => {
  it("returns 0 for identical points", () => {
    expect(haversineKm(47.5, 19.0, 47.5, 19.0)).toBeCloseTo(0)
  })

  it("matches a known distance (Budapest → Vienna ≈ 215 km)", () => {
    const d = haversineKm(47.4979, 19.0402, 48.2082, 16.3738)
    expect(d).toBeGreaterThan(210)
    expect(d).toBeLessThan(220)
  })
})

describe("bearingDeg", () => {
  it("returns ~90° due east", () => {
    expect(bearingDeg(0, 0, 0, 1)).toBeCloseTo(90, 0)
  })

  it("returns ~0° due north", () => {
    expect(bearingDeg(0, 0, 1, 0)).toBeCloseTo(0, 0)
  })

  it("always normalizes to [0,360)", () => {
    const b = bearingDeg(0, 0, 0, -1)
    expect(b).toBeGreaterThanOrEqual(0)
    expect(b).toBeLessThan(360)
  })
})

describe("compassDir", () => {
  it("maps cardinal bearings", () => {
    expect(compassDir(0)).toBe("N")
    expect(compassDir(90)).toBe("E")
    expect(compassDir(180)).toBe("S")
    expect(compassDir(270)).toBe("W")
  })

  it("maps inter-cardinals", () => {
    expect(compassDir(45)).toBe("NE")
    expect(compassDir(135)).toBe("SE")
  })
})

describe("formatDistance", () => {
  it("uses meters under 1 km", () => {
    expect(formatDistance(0.85)).toBe("850 m")
  })

  it("uses one decimal under 100 km", () => {
    expect(formatDistance(12.4)).toBe("12.4 km")
  })

  it("uses thousands separator for large distances", () => {
    expect(formatDistance(1240)).toMatch(/1[,.]240 km/)
  })
})
