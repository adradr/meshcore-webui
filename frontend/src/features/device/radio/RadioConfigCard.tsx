/**
 * RadioConfigCard — composes RegionPicker + ProfileCard + RadioReadout +
 * Custom toggle + AdvancedPanel + Apply.
 *
 * Owns all radio-config form state. Delegates the typed-APPLY confirm
 * dialog to RadioApplyDialog.
 */
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import {
  RADIO_PRESETS,
  availableRegions,
  matchPreset,
  presetsByRegion,
  type Region,
} from "../radioPresets"
import { useRadio, useSetRadio } from "../radioQueries"
import type { RadioConfig } from "../types"
import { RegionPicker } from "./RegionPicker"
import { ProfileCard } from "./ProfileCard"
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
  // `userChoseCustom` lets the user explicitly enable the Custom toggle
  // even when the current form happens to match a known preset —
  // they're declaring intent to tweak, not just observing.
  const [userChoseCustom, setUserChoseCustom] = useState(false)
  const matchedPreset = userChoseCustom ? null : matchPreset(form)

  // ---- Region state ----
  // Track the user's selected region separately so they can browse
  // sibling regions without an auto-match overriding their pick.
  const presetsGrouped = presetsByRegion()
  const regions = availableRegions()
  const [region, setRegion] = useState<Region | null>(
    matchedPreset?.region ?? null,
  )

  // When the form matches a known preset (e.g. after initial seed or
  // after a refetch), pull the region from the matched preset — but
  // ONLY when the user hasn't already explicitly chosen a region.
  useEffect(() => {
    if (matchedPreset && region === null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRegion(matchedPreset.region)
    }
  }, [matchedPreset, region])

  // ---- Region change handler ----
  const onRegionChange = (next: Region) => {
    setRegion(next)
    setUserChoseCustom(false)
    setManuallyClosed(false)
    const regionPresets = presetsGrouped[next] ?? []
    if (regionPresets.length === 0) return
    // If the current form already matches a preset in this region,
    // keep the existing values. Otherwise pick the first preset in
    // the region (don't silently flip to Custom).
    const stillMatches = regionPresets.find(
      (p) =>
        p.freq === form.freq &&
        p.bw === form.bw &&
        p.sf === form.sf &&
        p.cr === form.cr,
    )
    if (stillMatches) return
    const first = regionPresets[0]
    setForm({ freq: first.freq, bw: first.bw, sf: first.sf, cr: first.cr })
  }

  // ---- Profile (preset) change handler ----
  const onProfileChange = (id: string) => {
    const preset = RADIO_PRESETS.find((p) => p.id === id)
    if (!preset) return
    setUserChoseCustom(false)
    setManuallyClosed(false)
    setForm({ freq: preset.freq, bw: preset.bw, sf: preset.sf, cr: preset.cr })
  }

  // ---- Custom toggle ----
  const onCustomToggle = (next: boolean) => {
    setUserChoseCustom(next)
    if (next) setManuallyClosed(false)
  }

  // ---- Advanced collapsible ----
  // Open by default when the user is in Custom mode. `manuallyClosed`
  // captures an explicit user override (close the disclosure while
  // still in Custom). Changing profile/region clears the override.
  const [manuallyClosed, setManuallyClosed] = useState(false)
  const advancedOpen = userChoseCustom && !manuallyClosed

  // ---- Apply / reset ----
  const isDirty = readout ? !configEquals(form, readout) : false

  const onApply = (confirmedForm: RadioConfig) => {
    setRadio.mutate(confirmedForm, {
      onSuccess: (data) => {
        if (data.reconnected) {
          toast.success("Radio reconfigured — companion link back")
        } else {
          toast.warning(
            "Radio reconfigured — supervisor still re-establishing the companion link",
          )
        }
      },
    })
  }

  const onReset = () => {
    if (!readout) return
    setForm({ freq: readout.freq, bw: readout.bw, sf: readout.sf, cr: readout.cr })
    setUserChoseCustom(false)
    setManuallyClosed(false)
    setRegion(matchPreset(readout)?.region ?? null)
  }

  const currentPresetLabel = matchedPreset?.humanLabel ?? "Custom"

  const regionPresets = region ? (presetsGrouped[region] ?? []) : []

  return (
    <Card>
      <CardHeader className="space-y-1 pb-4">
        <CardTitle className="text-base">Radio Configuration</CardTitle>
        <CardDescription className="text-xs">
          Frequency, bandwidth, spreading factor, and coding rate must match
          every node you want to hear — picking the wrong preset silently
          isolates this device from the local mesh. Use the regional defaults
          listed by the community for your area, then only switch to Custom if
          you know what you are doing.{" "}
          <a
            href="https://meshcore.co.uk/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-foreground"
          >
            meshcore.co.uk
          </a>
          .
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <>
            {/* Step 1 — Region */}
            <RegionPicker
              regions={regions}
              value={region}
              onChange={onRegionChange}
              disabled={setRadio.isPending}
            />

            {/* Step 2 — Profile (only when not in Custom mode and a region is chosen) */}
            {!userChoseCustom && region && regionPresets.length > 0 && (
              <ProfileCard
                presets={regionPresets}
                selectedId={matchedPreset?.id ?? null}
                onChange={onProfileChange}
                disabled={setRadio.isPending}
              />
            )}

            {/* Custom toggle */}
            <div className="flex items-center justify-between rounded-md border border-dashed border-border p-3">
              <div className="flex flex-col gap-0.5">
                <Label
                  htmlFor="radio-custom-toggle"
                  className="text-sm font-medium"
                >
                  Custom configuration
                </Label>
                <span className="text-xs text-muted-foreground">
                  Edit frequency / BW / SF / CR by hand. Only do this if you
                  know what you are doing.
                </span>
              </div>
              <Switch
                id="radio-custom-toggle"
                data-testid="radio-custom-toggle"
                checked={userChoseCustom}
                onCheckedChange={onCustomToggle}
                disabled={setRadio.isPending}
                aria-label="Custom configuration"
              />
            </div>

            <Separator />

            {/* Big readout */}
            <RadioReadout config={form} />

            <Separator />

            {/* Advanced disclosure — only meaningful in Custom mode */}
            {userChoseCustom && (
              <AdvancedPanel
                open={advancedOpen}
                onOpenChange={(next) => setManuallyClosed(!next)}
                form={form}
                onFormChange={setForm}
                disabled={setRadio.isPending}
              />
            )}

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
