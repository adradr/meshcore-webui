import type { RadioConfig } from "./types"

export type Region = "EU" | "US" | "AU" | "KR" | "IN" | "HK" | "Global"

export interface RadioPreset {
  id: string
  /**
   * Original short label (e.g. "EU 868 — public"). Kept for backwards
   * compatibility with code/tests that still reference it.
   */
  label: string
  /**
   * Human-friendly profile label shown in the new Region → Profile UI
   * (e.g. "Public — Long Range"). Bound to a region, not standalone.
   */
  humanLabel: string
  /**
   * One-sentence description shown beneath the humanLabel in the
   * profile picker.
   */
  description: string
  region: Region
  freq: number
  bw: number
  sf: 7 | 8 | 9 | 10 | 11 | 12
  cr: 5 | 6 | 7 | 8
}

// MeshCore community-published regional defaults. CONFIRM each row
// against the firmware's regional table before merging the wider
// feature — these are the values commonly used today but the
// firmware may have bumped them; this list is the schema, not the
// truth.
export const RADIO_PRESETS: readonly RadioPreset[] = [
  {
    id: "eu_868_pub",
    label: "EU 868 — public",
    humanLabel: "Public — Long Range",
    description: "Default EU 868 net for most public chatter.",
    region: "EU",
    freq: 869.525,
    bw: 250,
    sf: 11,
    cr: 5,
  },
  {
    id: "eu_868_alt",
    label: "EU 868 — alt",
    humanLabel: "Alt — Long Range",
    description: "EU 868 alternate net (different freq).",
    region: "EU",
    freq: 868.1,
    bw: 250,
    sf: 11,
    cr: 5,
  },
  {
    id: "us_915_pub",
    label: "US 915 — public",
    humanLabel: "Public — Long Range",
    description: "Default US 915 net.",
    region: "US",
    freq: 910.525,
    bw: 250,
    sf: 11,
    cr: 5,
  },
  {
    id: "au_915_pub",
    label: "AU 915 — public",
    humanLabel: "Public — Long Range",
    description: "Default AU 915 net.",
    region: "AU",
    freq: 915.8,
    bw: 250,
    sf: 11,
    cr: 5,
  },
  {
    id: "kr_920",
    label: "KR 920",
    humanLabel: "Public",
    description: "Korean 920 MHz default.",
    region: "KR",
    freq: 920.9,
    bw: 250,
    sf: 11,
    cr: 5,
  },
  {
    id: "in_866",
    label: "IN 866",
    humanLabel: "Public",
    description: "Indian 866 MHz default.",
    region: "IN",
    freq: 866.0,
    bw: 250,
    sf: 11,
    cr: 5,
  },
  {
    id: "hk_920",
    label: "HK 920",
    humanLabel: "Public",
    description: "Hong Kong 920 MHz default.",
    region: "HK",
    freq: 920.9,
    bw: 250,
    sf: 11,
    cr: 5,
  },
  {
    id: "iso_433",
    label: "433 ISM",
    humanLabel: "ISM 433",
    description: "Global ISM 433 — short range, license-free.",
    region: "Global",
    freq: 433.05,
    bw: 125,
    sf: 12,
    cr: 5,
  },
] as const

export function matchPreset(cfg: RadioConfig): RadioPreset | null {
  return RADIO_PRESETS.find(
    (p) =>
      p.freq === cfg.freq &&
      p.bw === cfg.bw &&
      p.sf === cfg.sf &&
      p.cr === cfg.cr,
  ) ?? null
}

/**
 * Returns presets grouped by region, ordered by the first appearance
 * of each region in RADIO_PRESETS. Only regions with at least one
 * preset are included.
 */
export function presetsByRegion(): Record<Region, RadioPreset[]> {
  const out = {} as Record<Region, RadioPreset[]>
  for (const preset of RADIO_PRESETS) {
    if (!out[preset.region]) out[preset.region] = []
    out[preset.region].push(preset)
  }
  return out
}

/**
 * Ordered list of regions that have at least one preset, in their
 * first-appearance order from RADIO_PRESETS.
 */
export function availableRegions(): Region[] {
  const seen: Region[] = []
  for (const preset of RADIO_PRESETS) {
    if (!seen.includes(preset.region)) seen.push(preset.region)
  }
  return seen
}
