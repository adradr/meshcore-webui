/**
 * RadioConfigCard — composes PresetGrid + RadioReadout + AdvancedPanel + Apply.
 *
 * Owns all radio-config form state. Delegates the typed-APPLY confirm dialog
 * to RadioApplyDialog.
 */
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { RADIO_PRESETS, matchPreset } from "../radioPresets"
import { useRadio, useSetRadio } from "../radioQueries"
import type { RadioConfig } from "../types"
import { PresetGrid, CUSTOM_ID } from "./PresetGrid"
import { RadioReadout } from "./RadioReadout"
import { AdvancedPanel } from "./AdvancedPanel"
import { RadioApplyDialog } from "./RadioApplyDialog"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function configEquals(a: RadioConfig, b: RadioConfig): boolean {
  return a.freq === b.freq && a.bw === b.bw && a.sf === b.sf && a.cr === b.cr
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RadioConfigCard() {
  const { data: readout, isLoading } = useRadio()
  const setRadio = useSetRadio()

  // ---- Form state ----
  const [form, setForm] = useState<RadioConfig>({
    freq: 869.525,
    bw: 250,
    sf: 11,
    cr: 5,
  })

  // Seed form from readout on first load
  const seededRef = useRef(false)
  useEffect(() => {
    if (readout && !seededRef.current) {
      seededRef.current = true
      setForm({ freq: readout.freq, bw: readout.bw, sf: readout.sf, cr: readout.cr })
    }
  }, [readout])

  // ---- Preset matching ----
  // `userChoseCustom` lets the user explicitly pick the Custom tile
  // even when the current form happens to match a known preset —
  // they're declaring intent to tweak, not just observing.
  const [userChoseCustom, setUserChoseCustom] = useState(false)
  const matchedPreset = userChoseCustom ? null : matchPreset(form)
  const selectedPresetId = matchedPreset?.id ?? CUSTOM_ID

  // ---- Advanced collapsible ----
  // Open by default when the user is in Custom mode. `manuallyClosed`
  // captures an explicit user override (close the disclosure while
  // still in Custom). Picking a different preset clears the override
  // — the next Custom selection auto-opens again.
  const [manuallyClosed, setManuallyClosed] = useState(false)
  const advancedOpen = selectedPresetId === CUSTOM_ID && !manuallyClosed

  // ---- Preset click handler ----
  const onPresetChange = (id: string) => {
    setManuallyClosed(false) // reset the manual override on any preset change
    if (id === CUSTOM_ID) {
      setUserChoseCustom(true)
      return
    }
    setUserChoseCustom(false)
    const preset = RADIO_PRESETS.find((p) => p.id === id)
    if (!preset) return
    setForm({ freq: preset.freq, bw: preset.bw, sf: preset.sf, cr: preset.cr })
  }

  // ---- Apply / reset ----
  const isDirty = readout ? !configEquals(form, readout) : false

  const onApply = (confirmedForm: RadioConfig) => {
    setRadio.mutate(confirmedForm, {
      onSuccess: (data) => {
        if (data.reconnected) {
          toast.success("Radio reconfigured — companion link back")
        } else {
          toast.warning("Radio reconfigured — supervisor still re-establishing the companion link")
        }
      },
    })
  }

  const onReset = () => {
    if (!readout) return
    setForm({ freq: readout.freq, bw: readout.bw, sf: readout.sf, cr: readout.cr })
  }

  const currentPresetLabel = matchedPreset?.label ?? "Custom"

  return (
    <Card>
      <CardHeader className="space-y-0 pb-4">
        <CardTitle className="text-base">Radio Configuration</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <>
            {/* Preset grid */}
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Preset
              </p>
              <PresetGrid
                selectedId={selectedPresetId}
                onChange={onPresetChange}
              />
            </div>

            <Separator />

            {/* Big readout */}
            <RadioReadout config={form} />

            <Separator />

            {/* Advanced disclosure */}
            <AdvancedPanel
              open={advancedOpen}
              onOpenChange={(next) => setManuallyClosed(!next)}
              form={form}
              onFormChange={setForm}
              disabled={setRadio.isPending}
            />

            {/* Footer actions */}
            <div className="flex items-center justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onReset}
                disabled={!isDirty || setRadio.isPending}
              >
                Reset to current
              </Button>

              <RadioApplyDialog
                presetLabel={currentPresetLabel}
                form={form}
                pending={setRadio.isPending}
                onConfirm={onApply}
              >
                <Button
                  type="button"
                  size="sm"
                  data-testid="radio-apply-btn"
                  disabled={!isDirty || setRadio.isPending}
                >
                  {setRadio.isPending ? "Re-tuning…" : "Apply…"}
                </Button>
              </RadioApplyDialog>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
