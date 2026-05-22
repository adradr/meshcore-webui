import type { RadioConfig } from "./types"

export interface RadioPreset {
  id: string
  label: string
  region: "EU" | "US" | "AU" | "KR" | "IN" | "HK" | "Global"
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
  { id: "eu_868_pub", label: "EU 868 — public",  region: "EU",     freq: 869.525, bw: 250, sf: 11, cr: 5 },
  { id: "eu_868_alt", label: "EU 868 — alt",     region: "EU",     freq: 868.100, bw: 250, sf: 11, cr: 5 },
  { id: "us_915_pub", label: "US 915 — public",  region: "US",     freq: 910.525, bw: 250, sf: 11, cr: 5 },
  { id: "au_915_pub", label: "AU 915 — public",  region: "AU",     freq: 915.800, bw: 250, sf: 11, cr: 5 },
  { id: "kr_920",     label: "KR 920",           region: "KR",     freq: 920.900, bw: 250, sf: 11, cr: 5 },
  { id: "in_866",     label: "IN 866",           region: "IN",     freq: 866.000, bw: 250, sf: 11, cr: 5 },
  { id: "hk_920",     label: "HK 920",           region: "HK",     freq: 920.900, bw: 250, sf: 11, cr: 5 },
  { id: "iso_433",    label: "433 ISM",          region: "Global", freq: 433.050, bw: 125, sf: 12, cr: 5 },
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
