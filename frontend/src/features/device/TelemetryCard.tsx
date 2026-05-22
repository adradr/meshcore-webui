/**
 * TelemetryCard — configure three independent telemetry sub-modes.
 *
 * Each mode takes a value 0..3 whose community convention labels are:
 *   0 = Off, 1 = Owner only, 2 = Starred contacts, 3 = All contacts
 *
 * NOTE: These labels follow MeshCore community convention as of 2026 and
 * may not match all firmware builds. Verify against your firmware at
 * docs.meshcore.dev/telemetry before deploying. Flag any discrepancies.
 *
 * Usage:
 *   <TelemetryCard selfInfo={data} />
 */
import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { SelfInfo } from "./queries"
import { useUpdatePolicy } from "./behaviourQueries"

// ---------------------------------------------------------------------------
// Telemetry mode option labels
// Community convention: 0=Off, 1=Owner, 2=Starred, 3=All
// DEVIATION NOTE: unverified against all firmware builds — confirm on hardware.
// ---------------------------------------------------------------------------
const TELEMETRY_OPTIONS = [
  { value: 0, label: "Off" },
  { value: 1, label: "Owner only" },
  { value: 2, label: "Starred contacts" },
  { value: 3, label: "All contacts" },
] as const

interface TelemetryFormState {
  base: number
  loc: number
  env: number
}

interface Props {
  selfInfo: SelfInfo | undefined
  isLoading: boolean
}

function TelemetrySelect({
  id,
  label,
  value,
  onChange,
  disabled,
}: {
  id: string
  label: string
  value: number
  onChange: (v: number) => void
  disabled: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <Label
        htmlFor={id}
        className="w-28 shrink-0 text-xs uppercase tracking-wide text-muted-foreground"
      >
        {label}
      </Label>
      <Select
        value={String(value)}
        onValueChange={(v) => onChange(Number(v))}
        disabled={disabled}
      >
        <SelectTrigger id={id} className="w-44" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {TELEMETRY_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={String(opt.value)}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export function TelemetryCard({ selfInfo, isLoading }: Props) {
  const updatePolicy = useUpdatePolicy()
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<TelemetryFormState>({ base: 0, loc: 0, env: 0 })

  const startEdit = () => {
    // `z.looseObject` widens declared keys to `unknown` in some TS
    // resolution paths via its index signature — coerce explicitly so
    // the form state stays strictly typed.
    setForm({
      base: Number(selfInfo?.telemetry_mode_base ?? 0),
      loc: Number(selfInfo?.telemetry_mode_loc ?? 0),
      env: Number(selfInfo?.telemetry_mode_env ?? 0),
    })
    setEditing(true)
  }

  const cancelEdit = () => setEditing(false)

  const onSave = () => {
    const current = {
      base: selfInfo?.telemetry_mode_base ?? 0,
      loc: selfInfo?.telemetry_mode_loc ?? 0,
      env: selfInfo?.telemetry_mode_env ?? 0,
    }
    // Only send changed fields
    const patch: { base?: number; loc?: number; env?: number } = {}
    if (form.base !== current.base) patch.base = form.base
    if (form.loc !== current.loc) patch.loc = form.loc
    if (form.env !== current.env) patch.env = form.env

    updatePolicy.mutate(
      { telemetry: patch },
      { onSuccess: () => setEditing(false) },
    )
  }

  const saving = updatePolicy.isPending

  const modeLabel = (v: number | undefined) =>
    TELEMETRY_OPTIONS.find((o) => o.value === v)?.label ?? "—"

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">Telemetry modes</CardTitle>
        {!editing && !isLoading && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={startEdit}
            aria-label="Edit telemetry modes"
          >
            Edit
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : editing ? (
          <>
            <div className="space-y-3">
              <TelemetrySelect
                id="telemetry-base"
                label="Base"
                value={form.base}
                onChange={(v) => setForm((s) => ({ ...s, base: v }))}
                disabled={saving}
              />
              <TelemetrySelect
                id="telemetry-loc"
                label="Location"
                value={form.loc}
                onChange={(v) => setForm((s) => ({ ...s, loc: v }))}
                disabled={saving}
              />
              <TelemetrySelect
                id="telemetry-env"
                label="Environment"
                value={form.env}
                onChange={(v) => setForm((s) => ({ ...s, env: v }))}
                disabled={saving}
              />
            </div>
            <p className="text-xs italic text-muted-foreground">
              Labels follow MeshCore community convention — verify against your
              firmware.{" "}
              <a
                href="https://docs.meshcore.dev/telemetry"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-foreground"
              >
                docs.meshcore.dev/telemetry
              </a>
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={cancelEdit}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                data-testid="telemetry-save-btn"
                onClick={onSave}
                disabled={saving}
              >
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </>
        ) : (
          <div className="space-y-2">
            {(
              [
                ["Base", selfInfo?.telemetry_mode_base],
                ["Location", selfInfo?.telemetry_mode_loc],
                ["Environment", selfInfo?.telemetry_mode_env],
              ] as [string, number | undefined][]
            ).map(([label, val]) => (
              <div key={label} className="flex items-baseline justify-between gap-3">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  {label}
                </span>
                <span
                  data-testid={`telemetry-${label.toLowerCase()}-display`}
                  className="text-sm font-medium"
                >
                  {modeLabel(val)}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
