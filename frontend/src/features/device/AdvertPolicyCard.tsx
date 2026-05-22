/**
 * AdvertPolicyCard — adv_loc_policy, manual_add_contacts, multi_acks.
 *
 * NOTE: adv_loc_policy and multi_acks are firmware-defined enums with
 * no authoritative label set in public docs as of 2026-05. They are
 * presented as raw 0..255 integers. Confirm semantics against firmware
 * source or docs.meshcore.dev/policy before adding labels.
 *
 * Usage:
 *   <AdvertPolicyCard selfInfo={data} />
 */
import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import type { SelfInfo } from "./queries"
import { useUpdatePolicy } from "./behaviourQueries"

interface AdvertFormState {
  advLocPolicy: number
  manualAddContacts: boolean
  multiAcks: number
}

interface Props {
  selfInfo: SelfInfo | undefined
  isLoading: boolean
}

export function AdvertPolicyCard({ selfInfo, isLoading }: Props) {
  const updatePolicy = useUpdatePolicy()
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<AdvertFormState>({
    advLocPolicy: 0,
    manualAddContacts: false,
    multiAcks: 0,
  })

  const startEdit = () => {
    // `z.looseObject` widens declared keys to `unknown` in some TS
    // resolution paths — coerce explicitly so the form state stays
    // strictly typed.
    setForm({
      advLocPolicy: Number(selfInfo?.adv_loc_policy ?? 0),
      manualAddContacts: Boolean(selfInfo?.manual_add_contacts ?? false),
      multiAcks: Number(selfInfo?.multi_acks ?? 0),
    })
    setEditing(true)
  }

  const cancelEdit = () => setEditing(false)

  const clamp = (v: number) => Math.min(255, Math.max(0, Math.round(v)))

  const onSave = () => {
    const current = {
      advLocPolicy: selfInfo?.adv_loc_policy ?? 0,
      manualAddContacts: selfInfo?.manual_add_contacts ?? false,
      multiAcks: selfInfo?.multi_acks ?? 0,
    }
    // Only send changed fields
    const patch: {
      adv_loc_policy?: number
      manual_add_contacts?: boolean
      multi_acks?: number
    } = {}
    if (form.advLocPolicy !== current.advLocPolicy)
      patch.adv_loc_policy = form.advLocPolicy
    if (form.manualAddContacts !== current.manualAddContacts)
      patch.manual_add_contacts = form.manualAddContacts
    if (form.multiAcks !== current.multiAcks) patch.multi_acks = form.multiAcks

    updatePolicy.mutate(patch, { onSuccess: () => setEditing(false) })
  }

  const saving = updatePolicy.isPending

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">Advert + ack policy</CardTitle>
        {!editing && !isLoading && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={startEdit}
            aria-label="Edit advert policy"
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
            <div className="space-y-4">
              {/* ADV LOC POLICY */}
              <div className="space-y-1">
                <Label
                  htmlFor="adv-loc-policy"
                  className="text-xs uppercase tracking-wide text-muted-foreground"
                >
                  Adv loc policy
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="adv-loc-policy"
                    data-testid="adv-loc-policy-input"
                    type="number"
                    min={0}
                    max={255}
                    step={1}
                    className="w-24 font-mono"
                    value={form.advLocPolicy}
                    onChange={(e) =>
                      setForm((s) => ({
                        ...s,
                        advLocPolicy: clamp(Number(e.target.value)),
                      }))
                    }
                    disabled={saving}
                    aria-label="Adv loc policy (0–255, firmware-defined enum)"
                  />
                  <span className="text-xs text-muted-foreground">
                    0–255 · firmware-defined
                  </span>
                </div>
              </div>

              {/* MANUAL ADD CONTACTS */}
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <Label
                    htmlFor="manual-add-contacts"
                    className="text-xs uppercase tracking-wide text-muted-foreground"
                  >
                    Manual add contacts
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Off = all heard contacts auto-added
                  </p>
                </div>
                <Switch
                  id="manual-add-contacts"
                  data-testid="manual-add-contacts-switch"
                  checked={form.manualAddContacts}
                  onCheckedChange={(v) =>
                    setForm((s) => ({ ...s, manualAddContacts: v }))
                  }
                  disabled={saving}
                  aria-label="Manual add contacts"
                />
              </div>

              {/* MULTI ACKS */}
              <div className="space-y-1">
                <Label
                  htmlFor="multi-acks"
                  className="text-xs uppercase tracking-wide text-muted-foreground"
                >
                  Multi acks
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="multi-acks"
                    data-testid="multi-acks-input"
                    type="number"
                    min={0}
                    max={255}
                    step={1}
                    className="w-24 font-mono"
                    value={form.multiAcks}
                    onChange={(e) =>
                      setForm((s) => ({
                        ...s,
                        multiAcks: clamp(Number(e.target.value)),
                      }))
                    }
                    disabled={saving}
                    aria-label="Multi acks (0–255, firmware-defined)"
                  />
                  <span className="text-xs text-muted-foreground">
                    0–255 · firmware-defined
                  </span>
                </div>
              </div>
            </div>

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
                data-testid="advert-policy-save-btn"
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
                ["Adv loc policy", String(selfInfo?.adv_loc_policy ?? "—")],
                [
                  "Manual add contacts",
                  selfInfo?.manual_add_contacts ? "On" : "Off",
                ],
                ["Multi acks", String(selfInfo?.multi_acks ?? "—")],
              ] as const
            ).map(([label, val]) => (
              <div
                key={label}
                className="flex items-baseline justify-between gap-3"
              >
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  {label}
                </span>
                <span className="text-sm font-medium">{val}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
