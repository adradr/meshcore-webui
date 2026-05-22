import { describe, expect, it } from "vitest"
import {
  availableRegions,
  matchPreset,
  presetsByRegion,
  RADIO_PRESETS,
} from "../radioPresets"

describe("matchPreset", () => {
  it("returns the EU 868 public preset for matching config", () => {
    const result = matchPreset({ freq: 869.525, bw: 250, sf: 11, cr: 5 })
    expect(result).not.toBeNull()
    expect(result?.id).toBe("eu_868_pub")
    expect(result?.region).toBe("EU")
  })

  it("returns null when freq differs by a tiny amount", () => {
    const result = matchPreset({ freq: 869.526, bw: 250, sf: 11, cr: 5 })
    expect(result).toBeNull()
  })

  it("returns null when SF does not match", () => {
    const result = matchPreset({ freq: 869.525, bw: 250, sf: 9, cr: 5 })
    expect(result).toBeNull()
  })

  it("returns null when CR does not match", () => {
    const result = matchPreset({ freq: 869.525, bw: 250, sf: 11, cr: 6 })
    expect(result).toBeNull()
  })

  it("round-trips: every unique-param preset returns itself via matchPreset", () => {
    // kr_920 and hk_920 share identical RF params (920.900 MHz / BW250 /
    // SF11 / CR5). matchPreset returns the first match, which is kr_920.
    // These two presets are distinguished only by region label, not by
    // the RF parameters the matcher uses — this is a known ambiguity.
    const KNOWN_DUPLICATE_IDS = new Set(["hk_920"])

    for (const preset of RADIO_PRESETS) {
      if (KNOWN_DUPLICATE_IDS.has(preset.id)) continue
      const match = matchPreset({
        freq: preset.freq,
        bw: preset.bw,
        sf: preset.sf,
        cr: preset.cr,
      })
      expect(match).not.toBeNull()
      expect(match?.id).toBe(preset.id)
    }
  })

  it("returns null for a config not in the presets table", () => {
    const result = matchPreset({ freq: 999.999, bw: 500, sf: 8, cr: 7 })
    expect(result).toBeNull()
  })
})

describe("preset metadata", () => {
  it("every preset has a non-empty humanLabel and description", () => {
    for (const preset of RADIO_PRESETS) {
      expect(preset.humanLabel.length).toBeGreaterThan(0)
      expect(preset.description.length).toBeGreaterThan(0)
    }
  })
})

describe("presetsByRegion", () => {
  it("groups every preset under its declared region", () => {
    const grouped = presetsByRegion()
    let total = 0
    for (const region of Object.keys(grouped) as (keyof typeof grouped)[]) {
      for (const preset of grouped[region]) {
        expect(preset.region).toBe(region)
        total += 1
      }
    }
    expect(total).toBe(RADIO_PRESETS.length)
  })

  it("EU has both eu_868_pub and eu_868_alt", () => {
    const grouped = presetsByRegion()
    const ids = grouped.EU.map((p) => p.id)
    expect(ids).toContain("eu_868_pub")
    expect(ids).toContain("eu_868_alt")
  })

  it("Global region contains iso_433", () => {
    const grouped = presetsByRegion()
    expect(grouped.Global.map((p) => p.id)).toContain("iso_433")
  })
})

describe("availableRegions", () => {
  it("lists regions in first-appearance order from RADIO_PRESETS", () => {
    const regions = availableRegions()
    expect(regions[0]).toBe("EU")
    expect(regions).toContain("Global")
  })

  it("has no duplicates", () => {
    const regions = availableRegions()
    expect(new Set(regions).size).toBe(regions.length)
  })
})
