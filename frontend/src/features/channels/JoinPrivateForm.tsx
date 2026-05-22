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
 * Join an existing private channel by entering its name and 32-hex secret
 * (the same values that would be inside a `meshcore://channel/add` QR).
 *
 * The secret is REQUIRED here — that's the only thing distinguishing the
 * "join" flow from "create with auto-derive". `prefill` lets the QR-scan
 * flow seed the fields before the user confirms the write.
 */
export function JoinPrivateForm({
  prefill,
  onSuccess,
}: {
  prefill?: { name: string; secret: string }
  onSuccess: () => void
}) {
  const [name, setName] = useState(prefill?.name ?? "")
  const [secret, setSecret] = useState(prefill?.secret ?? "")
  const idx = useNextFreeChannelIdx()
  const add = useAddChannel()

  const slotFull = idx === null
  const trimmedSecret = secret.trim()
  const secretValid = PSK_HEX_RE.test(trimmedSecret)

  const submit = (e: React.SyntheticEvent) => {
    e.preventDefault()
    if (slotFull) return
    const trimmedName = name.trim()
    if (!trimmedName) {
      toast.error("Channel name is required")
      return
    }
    if (!secretValid) {
      toast.error("Secret must be exactly 32 hex characters")
      return
    }
    add.mutate(
      {
        idx: idx as number,
        name: trimmedName,
        psk: trimmedSecret.toLowerCase(),
      },
      {
        onSuccess: () => {
          toast.success(`Joined channel ${trimmedName}`)
          onSuccess()
        },
        onError: (err) => notifyError("Join channel", err),
      },
    )
  }

  return (
    <form onSubmit={submit} className="space-y-3 px-4 pb-4">
      <p className="text-xs text-muted-foreground">
        Enter the channel name and the 32-hex secret you received from the
        channel owner.
      </p>
      <div className="space-y-1">
        <Label htmlFor="join-private-name">Channel name</Label>
        <Input
          id="join-private-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={32}
          autoFocus
          required
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="join-private-secret">Secret (32 hex chars)</Label>
        <Input
          id="join-private-secret"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          maxLength={32}
          aria-invalid={
            trimmedSecret.length > 0 && !secretValid ? true : undefined
          }
          required
        />
        {trimmedSecret.length > 0 && !secretValid && (
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
        {add.isPending ? "Joining…" : "Join channel"}
      </Button>
    </form>
  )
}
