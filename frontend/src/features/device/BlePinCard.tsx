/**
 * BlePinCard — write-only BLE pairing PIN.
 *
 * The PIN is write-only on the device so there is no view mode.
 * The card stays permanently in "set a new PIN" mode.
 *
 * Usage:
 *   <BlePinCard />
 */
import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useSetBlePin } from "./behaviourQueries"

export function BlePinCard() {
  const [pin, setPin] = useState("")
  const [open, setOpen] = useState(false)
  const setBlePinMutation = useSetBlePin()

  const saving = setBlePinMutation.isPending
  const pinNum = parseInt(pin, 10)
  const canSave =
    /^\d{1,6}$/.test(pin) && pinNum >= 0 && pinNum <= 999_999

  const onSave = () => {
    if (!canSave) return
    setBlePinMutation.mutate(
      { pin: pinNum },
      {
        onSuccess: () => {
          setPin("")
          setOpen(false)
        },
      },
    )
  }

  const cancelEdit = () => {
    setPin("")
    setOpen(false)
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">BLE pairing PIN</CardTitle>
        {!open && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setOpen(true)}
            aria-label="Set BLE PIN"
          >
            Set PIN
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {!open ? (
          <p className="text-sm text-muted-foreground">
            Pairing PIN is write-only — the current value cannot be read back
            from the device. Use "Set PIN" to change it.
          </p>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Set a new PIN to use when pairing over BLE. The current value
              cannot be read back from the device.
            </p>
            <div className="space-y-1">
              <Label
                htmlFor="ble-pin"
                className="text-xs uppercase tracking-wide text-muted-foreground"
              >
                New PIN
              </Label>
              <Input
                id="ble-pin"
                data-testid="ble-pin-input"
                inputMode="numeric"
                pattern="[0-9]{1,6}"
                placeholder="000000"
                maxLength={6}
                className="w-36 font-mono"
                value={pin}
                onChange={(e) => {
                  // Only allow digits
                  const val = e.target.value.replace(/\D/g, "")
                  setPin(val)
                }}
                disabled={saving}
                aria-label="New BLE PIN (6-digit, 0–999999)"
              />
              {pin !== "" && !canSave && (
                <p className="text-xs text-destructive">
                  Enter a number 0–999999 (up to 6 digits).
                </p>
              )}
            </div>

            <div className="flex justify-end gap-2">
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
                data-testid="ble-pin-save-btn"
                onClick={onSave}
                disabled={saving || !canSave}
              >
                {saving ? "Setting…" : "Set PIN"}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
