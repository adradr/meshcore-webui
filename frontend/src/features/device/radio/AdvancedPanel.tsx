/**
 * AdvancedPanel — collapsible disclosure for custom frequency / BW / SF / CR inputs.
 *
 * Frequency range: 100–2500 MHz (matches backend Pydantic Field gt=100.0, lt=2500.0).
 */
import { ChevronDown, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { RadioConfig } from "../types"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BW_OPTIONS = [62.5, 125, 250, 500] as const
const SF_OPTIONS = [7, 8, 9, 10, 11, 12] as const
const CR_OPTIONS = [5, 6, 7, 8] as const

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface AdvancedPanelProps {
  open: boolean
  onOpenChange: (v: boolean) => void
  form: RadioConfig
  onFormChange: (f: RadioConfig) => void
  disabled: boolean
}

export function AdvancedPanel({
  open,
  onOpenChange,
  form,
  onFormChange,
  disabled,
}: AdvancedPanelProps) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="flex w-full items-center justify-start gap-1 px-0 text-sm font-medium text-muted-foreground hover:text-foreground"
          aria-label="Advanced (custom values)"
        >
          {open ? (
            <ChevronDown className="h-4 w-4 shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0" />
          )}
          Advanced (custom values)
        </Button>
      </CollapsibleTrigger>

      <CollapsibleContent className="mt-3 space-y-4">
        {/* FREQUENCY */}
        <div className="flex flex-col gap-1.5">
          <Label
            htmlFor="radio-freq"
            className="text-xs uppercase tracking-wide text-muted-foreground"
          >
            Frequency
          </Label>
          <div className="flex items-center gap-2">
            <Input
              id="radio-freq"
              aria-label="FREQUENCY"
              type="number"
              step="0.001"
              min={100}
              max={2500}
              className="w-36 font-mono"
              value={form.freq}
              onChange={(e) =>
                onFormChange({
                  ...form,
                  freq: Number.parseFloat(e.target.value) || form.freq,
                })
              }
              disabled={disabled}
            />
            <span className="text-sm text-muted-foreground">MHz (100–2500)</span>
          </div>
        </div>

        {/* BANDWIDTH */}
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">
            Bandwidth
          </Label>
          <ToggleGroup
            type="single"
            value={String(form.bw)}
            onValueChange={(v) => {
              if (!v) return
              onFormChange({ ...form, bw: Number(v) as RadioConfig["bw"] })
            }}
            spacing={0}
            variant="outline"
            size="sm"
          >
            {BW_OPTIONS.map((bw) => (
              <ToggleGroupItem
                key={bw}
                value={String(bw)}
                aria-label={`${bw} kHz`}
                disabled={disabled}
                className="font-mono"
              >
                {bw}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <span className="text-xs text-muted-foreground">kHz</span>
        </div>

        {/* SF */}
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">
            SF
          </Label>
          <ToggleGroup
            type="single"
            value={String(form.sf)}
            onValueChange={(v) => {
              if (!v) return
              onFormChange({ ...form, sf: Number(v) as RadioConfig["sf"] })
            }}
            spacing={0}
            variant="outline"
            size="sm"
          >
            {SF_OPTIONS.map((sf) => (
              <ToggleGroupItem
                key={sf}
                value={String(sf)}
                aria-label={`SF ${sf}`}
                disabled={disabled}
                className="font-mono"
              >
                {sf}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        {/* CR */}
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">
            CR
          </Label>
          <ToggleGroup
            type="single"
            value={String(form.cr)}
            onValueChange={(v) => {
              if (!v) return
              onFormChange({ ...form, cr: Number(v) as RadioConfig["cr"] })
            }}
            spacing={0}
            variant="outline"
            size="sm"
          >
            {CR_OPTIONS.map((cr) => (
              <ToggleGroupItem
                key={cr}
                value={String(cr)}
                aria-label={`CR 4/${cr}`}
                disabled={disabled}
                className="font-mono"
              >
                4/{cr}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
