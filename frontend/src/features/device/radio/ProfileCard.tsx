/**
 * ProfileCard — second step of the two-step Region → Profile selector.
 *
 * Renders a RadioGroup of card-style tiles, one per preset within the
 * currently selected region. Each tile shows the humanLabel,
 * description, the raw freq/BW/SF/CR line, and an estimated time-on-air
 * for a 100-byte payload (the canonical MeshCore short-packet size).
 */
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { airtimeMs } from "../loraMath"
import type { RadioPreset } from "../radioPresets"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function presetDetails(p: RadioPreset): string {
  return `${p.freq} MHz · ${p.bw} kHz · SF${p.sf} · CR4/${p.cr}`
}

function airtimeLabel(p: RadioPreset): string {
  const ms = airtimeMs(100, { freq: p.freq, bw: p.bw, sf: p.sf, cr: p.cr })
  if (ms >= 1000) return `≈ ${(ms / 1000).toFixed(2)}s / 100 B`
  return `≈ ${Math.round(ms)}ms / 100 B`
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface ProfileCardProps {
  presets: RadioPreset[]
  selectedId: string | null
  onChange: (id: string) => void
  disabled?: boolean
}

export function ProfileCard({
  presets,
  selectedId,
  onChange,
  disabled,
}: ProfileCardProps) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Profile
      </p>
      <RadioGroup
        value={selectedId ?? ""}
        onValueChange={onChange}
        className="grid grid-cols-1 gap-2 sm:grid-cols-2"
        aria-label="Radio profile"
        disabled={disabled}
      >
        {presets.map((preset) => (
          <Label
            key={preset.id}
            htmlFor={`profile-${preset.id}`}
            data-testid={`profile-tile-${preset.id}`}
            className={[
              "flex cursor-pointer flex-col gap-1 rounded-md border p-3 transition-colors",
              "hover:bg-accent",
              selectedId === preset.id
                ? "ring-2 ring-primary border-primary bg-accent/50"
                : "border-border",
            ].join(" ")}
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem
                id={`profile-${preset.id}`}
                value={preset.id}
                aria-label={preset.humanLabel}
                className="shrink-0"
              />
              <span className="text-sm font-medium leading-snug">
                {preset.humanLabel}
              </span>
            </div>
            <span className="pl-6 text-xs text-muted-foreground">
              {preset.description}
            </span>
            <span
              className="pl-6 font-mono text-xs text-muted-foreground"
              data-testid={`profile-details-${preset.id}`}
            >
              {presetDetails(preset)}
            </span>
            <span
              className="pl-6 font-mono text-[11px] text-muted-foreground/80"
              data-testid={`profile-airtime-${preset.id}`}
            >
              {airtimeLabel(preset)}
            </span>
          </Label>
        ))}
      </RadioGroup>
    </div>
  )
}
