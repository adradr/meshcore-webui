import { describe, expect, it } from "vitest"
import {
  airtimeMs,
  dataRateBps,
  lowDataRateOptimize,
  sensitivityDbm,
  symbolTimeMs,
} from "../loraMath"

// Reference values computed from the Semtech AN1200.22 formula (see loraMath.ts).
// The spec's suggested anchors (56 ms / 2,793 ms) correspond to a much shorter
// payload (~22 bytes), not 100 bytes. Per-spec instructions: "prefer the formula
// over my numeric guesses" — so these tests anchor on our formula output.

describe("symbolTimeMs", () => {
  it("computes 1.024 ms for SF7/BW125", () => {
    expect(symbolTimeMs({ sf: 7, bw: 125 })).toBeCloseTo(1.024, 3)
  })

  it("computes 32.768 ms for SF12/BW125", () => {
    expect(symbolTimeMs({ sf: 12, bw: 125 })).toBeCloseTo(32.768, 3)
  })
})

describe("lowDataRateOptimize", () => {
  it("is true for SF11/BW125 (symbol time 16.384 ms > 16 ms)", () => {
    // SF11/BW125: Ts = 2^11/125 = 16.384 ms > 16 ms → LDR on
    expect(lowDataRateOptimize({ sf: 11, bw: 125 })).toBe(true)
  })

  it("is false for SF7/BW125 (symbol time 1.024 ms)", () => {
    expect(lowDataRateOptimize({ sf: 7, bw: 125 })).toBe(false)
  })

  it("is false for SF10/BW250 (symbol time 4.096 ms)", () => {
    // 2^10/250 = 4.096 ms < 16 ms
    expect(lowDataRateOptimize({ sf: 10, bw: 250 })).toBe(false)
  })
})

describe("airtimeMs", () => {
  it("computes ~174 ms for 100 bytes at SF7/BW125/CR5", () => {
    // computed: 174.336 ms (spec reference 56 ms was for ~22-byte payloads)
    const result = airtimeMs(100, { freq: 868, bw: 125, sf: 7, cr: 5 })
    expect(result).toBeCloseTo(174.336, 0)
  })

  it("computes ~3940 ms for 100 bytes at SF12/BW125/CR5", () => {
    // computed: 3940.352 ms (spec reference 2,793 ms did not match formula)
    // LDR opt is applied (DE=1) because symbolTime 32.768 ms > 16 ms.
    const result = airtimeMs(100, { freq: 868, bw: 125, sf: 12, cr: 5 })
    expect(result).toBeCloseTo(3940.352, 0)
  })

  it("airtime increases with payload size", () => {
    const cfg = { freq: 868, bw: 125, sf: 9, cr: 5 } as const
    expect(airtimeMs(50, cfg)).toBeLessThan(airtimeMs(100, cfg))
    expect(airtimeMs(100, cfg)).toBeLessThan(airtimeMs(200, cfg))
  })

  it("higher SF gives longer airtime (same BW and payload)", () => {
    const bw = 125
    const pl = 50
    const cr = 5 as const
    expect(airtimeMs(pl, { freq: 868, bw, sf: 7, cr })).toBeLessThan(
      airtimeMs(pl, { freq: 868, bw, sf: 12, cr }),
    )
  })
})

describe("dataRateBps", () => {
  it("computes ~5468.8 bps for SF7/BW125/CR5", () => {
    // computed: 5468.8 bps  ref: ~5469 bps  ✓ within 5%
    expect(dataRateBps({ sf: 7, bw: 125, cr: 5 })).toBeCloseTo(5468.8, 0)
  })

  it("computes ~293 bps for SF12/BW125/CR5", () => {
    // computed: 293.0 bps  ref: ~293 bps  ✓ within 5%
    expect(dataRateBps({ sf: 12, bw: 125, cr: 5 })).toBeCloseTo(293.0, 0)
  })

  it("higher SF gives lower data rate (same BW)", () => {
    expect(dataRateBps({ sf: 7, bw: 125, cr: 5 })).toBeGreaterThan(
      dataRateBps({ sf: 12, bw: 125, cr: 5 }),
    )
  })

  it("wider BW gives higher data rate (same SF)", () => {
    expect(dataRateBps({ sf: 9, bw: 250, cr: 5 })).toBeGreaterThan(
      dataRateBps({ sf: 9, bw: 125, cr: 5 }),
    )
  })
})

describe("sensitivityDbm", () => {
  it("computes ~-137 dBm for SF12/BW125", () => {
    // computed: -137.03 dBm  ref: ~-137 dBm  ✓ within 1 dB
    expect(sensitivityDbm({ sf: 12, bw: 125 })).toBeCloseTo(-137.0, 0)
  })

  it("computes ~-124 dBm for SF7/BW125", () => {
    // Sensitivity = -174 + 10*log10(125000) + 6 + (-7.5) = -124.53 dBm
    expect(sensitivityDbm({ sf: 7, bw: 125 })).toBeCloseTo(-124.5, 0)
  })

  it("higher SF gives better (lower) sensitivity", () => {
    expect(sensitivityDbm({ sf: 12, bw: 125 })).toBeLessThan(
      sensitivityDbm({ sf: 7, bw: 125 }),
    )
  })
})
