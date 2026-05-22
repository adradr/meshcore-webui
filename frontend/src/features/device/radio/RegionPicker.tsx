/**
 * RegionPicker — first step of the two-step Region → Profile preset selector.
 *
 * A compact shadcn Select listing the regions that have at least one
 * preset. The Custom configuration toggle lives outside this picker
 * (in RadioConfigCard) — switching regions here never enters Custom mode.
 */
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { Region } from "../radioPresets"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Human label for each region in the Select dropdown. Kept here (not
 * in radioPresets.ts) because this is purely a UI concern.
 */
const REGION_LABELS: Record<Region, string> = {
  EU: "EU (868 MHz)",
  US: "US (915 MHz)",
  AU: "AU (915 MHz)",
  KR: "KR (920 MHz)",
  IN: "IN (866 MHz)",
  HK: "HK (920 MHz)",
  Global: "Global (433 MHz ISM)",
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface RegionPickerProps {
  /** Regions to list — typically the result of availableRegions(). */
  regions: readonly Region[]
  /** Currently selected region, or null when no region matches. */
  value: Region | null
  /** Fires whenever the user picks a different region. */
  onChange: (region: Region) => void
  /** Optional disabled state — e.g. while a mutation is in flight. */
  disabled?: boolean
}

export function RegionPicker({
  regions,
  value,
  onChange,
  disabled,
}: RegionPickerProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label
        htmlFor="radio-region"
        className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
      >
        Region
      </Label>
      <Select
        value={value ?? undefined}
        onValueChange={(v) => onChange(v as Region)}
        disabled={disabled}
      >
        <SelectTrigger
          id="radio-region"
          data-testid="region-picker-trigger"
          className="w-full sm:w-64"
          aria-label="Region"
        >
          <SelectValue placeholder="Pick a region…" />
        </SelectTrigger>
        <SelectContent>
          {regions.map((region) => (
            <SelectItem
              key={region}
              value={region}
              data-testid={`region-item-${region}`}
            >
              {REGION_LABELS[region] ?? region}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
