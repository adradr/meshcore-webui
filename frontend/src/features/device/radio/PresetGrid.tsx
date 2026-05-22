/**
 * PresetGrid — card-style RadioGroup tiles for selecting a regional preset.
 */
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { RADIO_PRESETS } from "../radioPresets"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CUSTOM_ID = "custom"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function presetSubtext(p: { freq: number; bw: number; sf: number; cr: number }): string {
  return `${p.freq} / ${p.bw} / SF${p.sf} / CR${p.cr}`
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface PresetGridProps {
  selectedId: string
  onChange: (id: string) => void
}

export function PresetGrid({ selectedId, onChange }: PresetGridProps) {
  return (
    <RadioGroup
      value={selectedId}
      onValueChange={onChange}
      className="grid grid-cols-2 gap-2 sm:grid-cols-3"
      aria-label="Radio preset"
    >
      {RADIO_PRESETS.map((preset) => (
        <Label
          key={preset.id}
          htmlFor={`preset-${preset.id}`}
          data-testid={`preset-tile-${preset.id}`}
          className={[
            "flex cursor-pointer flex-col gap-0.5 rounded-md border p-3 transition-colors",
            "hover:bg-accent",
            selectedId === preset.id
              ? "ring-2 ring-primary border-primary bg-accent/50"
              : "border-border",
          ].join(" ")}
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem
              id={`preset-${preset.id}`}
              value={preset.id}
              aria-label={preset.label}
              className="shrink-0"
            />
            <span className="text-sm font-medium leading-snug">{preset.label}</span>
          </div>
          <span className="pl-6 font-mono text-xs text-muted-foreground">
            {presetSubtext(preset)}
          </span>
        </Label>
      ))}

      {/* Custom tile */}
      <Label
        htmlFor="preset-custom"
        data-testid="preset-tile-custom"
        className={[
          "flex cursor-pointer flex-col gap-0.5 rounded-md border p-3 transition-colors",
          "hover:bg-accent",
          selectedId === CUSTOM_ID
            ? "ring-2 ring-primary border-primary bg-accent/50"
            : "border-border",
        ].join(" ")}
      >
        <div className="flex items-center gap-2">
          <RadioGroupItem
            id="preset-custom"
            value={CUSTOM_ID}
            aria-label="Custom"
            className="shrink-0"
          />
          <span className="text-sm font-medium leading-snug">Custom…</span>
        </div>
        <span className="pl-6 font-mono text-xs text-muted-foreground">
          user-defined
        </span>
      </Label>
    </RadioGroup>
  )
}
