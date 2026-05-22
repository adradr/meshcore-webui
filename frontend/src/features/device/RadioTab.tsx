/**
 * RadioTab — Task 4.3
 *
 * Instrument-panel control surface for the radio configuration.
 * Composed of two cards:
 *  1. RadioConfigCard  — preset selector + big readout + advanced disclosure
 *                        + typed-confirm Apply dialog
 *  2. TxPowerCard      — Slider + dBm/mW display + calm Apply button
 *
 * Followed by RxTuningCard (Task 4.5) wired in by the page.
 *
 * Usage:
 *   <RadioTab />
 */
import { useEffect, useRef, useState } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import { toast } from "sonner"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Slider } from "@/components/ui/slider"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { RADIO_PRESETS, matchPreset } from "./radioPresets"
import {
  airtimeMs,
  dataRateBps,
  sensitivityDbm,
} from "./loraMath"
import { useRadio, useSetRadio, useSetTxPower } from "./radioQueries"
import type { RadioConfig } from "./types"
import { RxTuningCard } from "./RxTuningCard"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CUSTOM_ID = "custom"
const CONFIRM_TOKEN = "APPLY"

// Bandwidth options the firmware supports
const BW_OPTIONS = [62.5, 125, 250, 500] as const
const SF_OPTIONS = [7, 8, 9, 10, 11, 12] as const
const CR_OPTIONS = [5, 6, 7, 8] as const

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dbmToMw(dbm: number): number {
  return Math.round(Math.pow(10, dbm / 10))
}

function configEquals(a: RadioConfig, b: RadioConfig): boolean {
  return a.freq === b.freq && a.bw === b.bw && a.sf === b.sf && a.cr === b.cr
}

// ---------------------------------------------------------------------------
// ReadoutDisplay — big Geist Mono one-liner
// ---------------------------------------------------------------------------

interface ReadoutDisplayProps {
  config: RadioConfig
}

function ReadoutDisplay({ config }: ReadoutDisplayProps) {
  const airtime = airtimeMs(100, config)
  const dr = dataRateBps(config)
  const sens = sensitivityDbm(config)

  const airtimeStr =
    airtime >= 1000
      ? `${(airtime / 1000).toFixed(2)} s`
      : `${Math.round(airtime)} ms`
  const drStr = dr >= 1000
    ? `${(dr / 1000).toFixed(2)} kbps`
    : `${Math.round(dr)} bps`
  const sensStr = `${Math.round(sens)} dBm`

  return (
    <div className="space-y-1">
      {/* Primary readout */}
      <p data-testid="radio-readout" className="font-mono text-2xl tracking-tight">
        {config.freq} MHz&nbsp;
        <span className="text-muted-foreground">·</span>
        &nbsp;BW {config.bw} kHz&nbsp;
        <span className="text-muted-foreground">·</span>
        &nbsp;SF {config.sf}&nbsp;
        <span className="text-muted-foreground">·</span>
        &nbsp;CR 4/{config.cr}
      </p>
      {/* Derived metrics */}
      <p data-testid="radio-metrics" className="font-mono text-sm text-muted-foreground">
        airtime/100B&nbsp;{airtimeStr}&nbsp;
        <span aria-hidden>·</span>
        &nbsp;data rate&nbsp;{drStr}&nbsp;
        <span aria-hidden>·</span>
        &nbsp;{sensStr}
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// PresetGrid — card-style RadioGroup tiles
// ---------------------------------------------------------------------------

interface PresetGridProps {
  selectedId: string
  onChange: (id: string) => void
}

function presetSubtext(p: { freq: number; bw: number; sf: number; cr: number }): string {
  return `${p.freq} / ${p.bw} / SF${p.sf} / CR${p.cr}`
}

function PresetGrid({ selectedId, onChange }: PresetGridProps) {
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

// ---------------------------------------------------------------------------
// AdvancedPanel — collapsible frequency / BW / SF / CR editors
// ---------------------------------------------------------------------------

interface AdvancedPanelProps {
  open: boolean
  onOpenChange: (v: boolean) => void
  form: RadioConfig
  onFormChange: (f: RadioConfig) => void
  disabled: boolean
}

function AdvancedPanel({
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
              min={400}
              max={1000}
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
            <span className="text-sm text-muted-foreground">MHz</span>
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

// ---------------------------------------------------------------------------
// RadioApplyDialog — typed-confirm AlertDialog
// ---------------------------------------------------------------------------

interface RadioApplyDialogProps {
  presetLabel: string
  form: RadioConfig
  pending: boolean
  onConfirm: (form: RadioConfig) => void
  children: React.ReactNode
}

function RadioApplyDialog({
  presetLabel,
  form,
  pending,
  onConfirm,
  children,
}: RadioApplyDialogProps) {
  const [typed, setTyped] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const ready = typed === CONFIRM_TOKEN

  return (
    <AlertDialog
      onOpenChange={(open) => {
        if (!open) setTyped("")
        // Auto-focus the input when the dialog opens
        if (open) {
          setTimeout(() => inputRef.current?.focus(), 50)
        }
      }}
    >
      <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Change radio configuration?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <span>
              Switching to{" "}
              <strong>{presetLabel}</strong> detunes this radio from any node
              still on the previous preset. The companion link will briefly drop
              while the modem re-initialises (~5 seconds).
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-1">
          <Label className="text-xs">
            Type{" "}
            <code className="rounded bg-muted px-1">{CONFIRM_TOKEN}</code> to
            confirm
          </Label>
          <Input
            ref={inputRef}
            data-testid="radio-apply-confirm-input"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={CONFIRM_TOKEN}
            disabled={pending}
            aria-label={`Confirm by typing ${CONFIRM_TOKEN}`}
            autoComplete="off"
          />
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            data-testid="radio-apply-confirm-btn"
            disabled={!ready || pending}
            onClick={(e) => {
              e.preventDefault()
              onConfirm(form)
            }}
          >
            {pending ? "Re-tuning…" : "Apply"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// ---------------------------------------------------------------------------
// RadioConfigCard
// ---------------------------------------------------------------------------

function RadioConfigCard() {
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
  const matchedPreset = matchPreset(form)
  const selectedPresetId = matchedPreset?.id ?? CUSTOM_ID

  // ---- Advanced collapsible ----
  // Auto-open when no preset matches; user can still toggle manually.
  const [advancedOpen, setAdvancedOpen] = useState(false)
  useEffect(() => {
    if (readout && matchPreset({ freq: readout.freq, bw: readout.bw, sf: readout.sf, cr: readout.cr }) === null) {
      setAdvancedOpen(true)
    }
  }, [readout])

  // Also open when form switches to Custom
  useEffect(() => {
    if (selectedPresetId === CUSTOM_ID) {
      setAdvancedOpen(true)
    }
  }, [selectedPresetId])

  // ---- Preset click handler ----
  const onPresetChange = (id: string) => {
    if (id === CUSTOM_ID) {
      setAdvancedOpen(true)
      return
    }
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
            <ReadoutDisplay config={form} />

            <Separator />

            {/* Advanced disclosure */}
            <AdvancedPanel
              open={advancedOpen}
              onOpenChange={setAdvancedOpen}
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

// ---------------------------------------------------------------------------
// TxPowerCard
// ---------------------------------------------------------------------------

function TxPowerCard() {
  const { data: readout, isLoading } = useRadio()
  const setTxPower = useSetTxPower()

  const [dbm, setDbm] = useState(0)

  // Seed from readout
  const txSeededRef = useRef(false)
  useEffect(() => {
    if (readout && !txSeededRef.current) {
      txSeededRef.current = true
      setDbm(readout.tx_power)
    }
  }, [readout])

  const maxDbm = readout?.max_tx_power ?? 22
  const mw = dbmToMw(dbm)

  const onApply = () => {
    setTxPower.mutate(dbm)
  }

  return (
    <Card>
      <CardHeader className="space-y-0 pb-4">
        <CardTitle className="text-base">TX Power</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : (
          <>
            <div className="flex items-center gap-4">
              <span className="w-6 shrink-0 text-right font-mono text-sm text-muted-foreground">
                0
              </span>
              <Slider
                min={0}
                max={maxDbm}
                step={1}
                value={[dbm]}
                onValueChange={([v]) => setDbm(v)}
                disabled={setTxPower.isPending}
                aria-label="TX power"
                className="flex-1"
              />
              <span className="w-6 shrink-0 font-mono text-sm text-muted-foreground">
                {maxDbm}
              </span>
              {/* Live readout to the right of slider */}
              <span className="w-28 shrink-0 font-mono text-base font-medium tabular-nums">
                {dbm} dBm ({mw} mW)
              </span>
            </div>

            <p className="text-xs text-muted-foreground">
              Currently: {readout?.tx_power} dBm. Hardware ceiling: {maxDbm} dBm.
            </p>

            <div className="flex justify-end">
              <Button
                type="button"
                size="sm"
                data-testid="tx-power-apply-btn"
                onClick={onApply}
                disabled={setTxPower.isPending}
              >
                {setTxPower.isPending ? "Applying…" : "Apply"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// RadioTab — public export
// ---------------------------------------------------------------------------

export function RadioTab() {
  return (
    <div className="flex flex-col gap-4">
      <RadioConfigCard />
      <TxPowerCard />
      <RxTuningCard />
    </div>
  )
}
