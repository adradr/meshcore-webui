/**
 * CustomVarsCard — list + edit firmware-defined key/value custom variables.
 *
 * Delete semantics: sets value to empty string ("") via PUT because the
 * backend exposes no dedicated DELETE endpoint. The firmware treats an
 * empty-string value as removal. This is a soft-delete pattern; if the
 * backend gains a DELETE endpoint this hook call should be swapped out.
 *
 * Usage:
 *   <CustomVarsCard />
 */
import { useState } from "react"
import { X } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Separator } from "@/components/ui/separator"
import { useCustomVars, useSetCustomVar } from "./behaviourQueries"

// Key must be 1–32 chars: letters, digits, underscores, hyphens.
const KEY_REGEX = /^[A-Za-z0-9_-]{1,32}$/

function coerceValue(raw: string): string | number {
  if (raw.trim() === "") return raw
  const n = Number(raw)
  return Number.isFinite(n) ? n : raw
}

interface AddRowProps {
  onSaved: () => void
}

function AddRow({ onSaved }: AddRowProps) {
  const [newKey, setNewKey] = useState("")
  const [newVal, setNewVal] = useState("")
  const setVar = useSetCustomVar()

  const saving = setVar.isPending
  const keyValid = KEY_REGEX.test(newKey)
  const canSave = keyValid && newVal !== ""

  const onSave = () => {
    if (!canSave) return
    setVar.mutate(
      { key: newKey, value: coerceValue(newVal) },
      {
        onSuccess: () => {
          setNewKey("")
          setNewVal("")
          onSaved()
        },
      },
    )
  }

  return (
    <div className="space-y-2 pt-2">
      <Separator />
      <div className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
        <div className="space-y-1">
          <Label
            htmlFor="new-cv-key"
            className="text-xs uppercase tracking-wide text-muted-foreground"
          >
            Key
          </Label>
          <Input
            id="new-cv-key"
            data-testid="custom-var-new-key"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            placeholder="rx_offset_hz"
            maxLength={32}
            disabled={saving}
            aria-label="New custom variable key"
          />
        </div>
        <div className="space-y-1">
          <Label
            htmlFor="new-cv-val"
            className="text-xs uppercase tracking-wide text-muted-foreground"
          >
            Value
          </Label>
          <Input
            id="new-cv-val"
            data-testid="custom-var-new-value"
            value={newVal}
            onChange={(e) => setNewVal(e.target.value)}
            placeholder="0"
            disabled={saving}
            aria-label="New custom variable value"
          />
        </div>
        <Button
          type="button"
          size="sm"
          data-testid="custom-var-add-save-btn"
          onClick={onSave}
          disabled={saving || !canSave}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
      {newKey !== "" && !keyValid && (
        <p className="text-xs text-destructive">
          Key must be 1–32 chars: letters, digits, underscores, hyphens.
        </p>
      )}
    </div>
  )
}

export function CustomVarsCard() {
  const { data: vars, isLoading } = useCustomVars()
  const setVar = useSetCustomVar()
  const [addingRow, setAddingRow] = useState(false)

  const onDelete = (key: string) => {
    // Soft-delete: set value to empty string.
    // Replace with DELETE endpoint call if the backend gains one.
    setVar.mutate({ key, value: "" })
  }

  const entries = vars ? Object.entries(vars) : []

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">Custom variables</CardTitle>
        {!addingRow && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setAddingRow(true)}
            aria-label="Add custom variable"
          >
            Add
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <div className="space-y-1">
            <p className="pb-1 text-xs text-muted-foreground">
              Firmware-defined key/value scalars.
            </p>

            {entries.length === 0 && !addingRow && (
              <p className="text-sm text-muted-foreground">
                No custom variables set on this device.
              </p>
            )}

            {entries.length > 0 && (
              <div className="space-y-1">
                {/* Header row */}
                <div className="grid grid-cols-[1fr_1fr_auto] gap-2 pb-1">
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">
                    Key
                  </span>
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">
                    Value
                  </span>
                  <span className="w-8" />
                </div>

                {entries.map(([key, value]) => (
                  <div
                    key={key}
                    data-testid={`custom-var-row-${key}`}
                    className="grid grid-cols-[1fr_1fr_auto] items-center gap-2 rounded-sm py-0.5 hover:bg-muted/40"
                  >
                    <span className="font-mono text-sm">{key}</span>
                    <span className="font-mono text-sm text-muted-foreground">
                      {String(value)}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => onDelete(key)}
                      disabled={setVar.isPending}
                      aria-label={`Delete ${key}`}
                      data-testid={`custom-var-delete-${key}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {addingRow && <AddRow onSaved={() => setAddingRow(false)} />}

            {addingRow && (
              <div className="flex justify-end pt-1">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setAddingRow(false)}
                  className="text-muted-foreground"
                >
                  Cancel
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
