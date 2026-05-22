import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { notifyError } from "@/lib/notify"
import {
  useAddChannel,
  useNextFreeChannelIdx,
} from "@/features/channels/queries"
import { PSK_HEX_RE } from "./validators"

/**
 * Form for creating a private channel. The user supplies a name and an
 * OPTIONAL 32-hex secret: when blank, the firmware derives the PSK from
 * sha256(name)[:16] just like every other no-PSK channel write.
 *
 * Slot selection is automatic — `useNextFreeChannelIdx()` picks the lowest
 * free slot. When the device is full the submit button is disabled and we
 * surface an explanation rather than letting a 4XX bubble through.
 */
export function CreatePrivateForm({ onSuccess }: { onSuccess: () => void }) {
  const [name, setName] = useState("")
  const [secret, setSecret] = useState("")
  const idx = useNextFreeChannelIdx()
  const add = useAddChannel()

  const slotFull = idx === null
  const trimmedSecret = secret.trim()
  const secretInvalid =
    trimmedSecret.length > 0 && !PSK_HEX_RE.test(trimmedSecret)

  const submit = (e: React.SyntheticEvent) => {
    e.preventDefault()
    if (slotFull) return
    const trimmedName = name.trim()
    if (!trimmedName) {
      toast.error("Channel name is required")
      return
    }
    if (secretInvalid) {
      toast.error("Secret must be 32 hex characters (or leave blank)")
      return
    }
    add.mutate(
      {
        idx: idx as number,
        name: trimmedName,
        psk: trimmedSecret ? trimmedSecret.toLowerCase() : null,
      },
      {
        onSuccess: () => {
          toast.success(`Created channel ${trimmedName}`)
          onSuccess()
        },
        onError: (err) => notifyError("Create channel", err),
      },
    )
  }

  return (
    <form onSubmit={submit} className="space-y-3 px-4 pb-4">
      <p className="text-xs text-muted-foreground">
        Private channels use a 16-byte secret. Leave the field blank to
        auto-derive a secret from the channel name (anyone with the same
        name will join the same channel).
      </p>
      <div className="space-y-1">
        <Label htmlFor="create-private-name">Channel name</Label>
        <Input
          id="create-private-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={32}
          autoFocus
          required
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="create-private-secret">
          Secret (optional, 32 hex chars)
        </Label>
        <Input
          id="create-private-secret"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          maxLength={32}
          placeholder="leave blank to derive from name"
          aria-invalid={secretInvalid || undefined}
        />
        {secretInvalid && (
          <p className="text-xs text-destructive">
            Must be exactly 32 hex characters.
          </p>
        )}
      </div>
      {slotFull && (
        <p className="text-xs text-destructive">
          All channel slots are in use. Remove a channel first.
        </p>
      )}
      <Button type="submit" disabled={add.isPending || slotFull}>
        {add.isPending ? "Creating…" : "Create channel"}
      </Button>
    </form>
  )
}
