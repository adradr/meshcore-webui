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
import { HASHTAG_RE } from "./validators"

/**
 * Join a "hashtag" channel — the convention where the channel name itself
 * starts with `#` and the PSK is derived from the name (so anyone using
 * the same hashtag converges on the same channel). The form forces the
 * leading `#` so the user can type either with or without it.
 */
export function JoinHashtagForm({ onSuccess }: { onSuccess: () => void }) {
  const [raw, setRaw] = useState("#")
  const idx = useNextFreeChannelIdx()
  const add = useAddChannel()

  const slotFull = idx === null
  const normalised = raw.startsWith("#") ? raw : `#${raw}`
  const valid = HASHTAG_RE.test(normalised)

  const submit = (e: React.SyntheticEvent) => {
    e.preventDefault()
    if (slotFull) return
    if (!valid) {
      toast.error("Hashtag must start with # followed by letters, digits or _")
      return
    }
    add.mutate(
      { idx: idx as number, name: normalised, psk: null },
      {
        onSuccess: () => {
          toast.success(`Joined ${normalised}`)
          onSuccess()
        },
        onError: (err) => notifyError("Join hashtag", err),
      },
    )
  }

  return (
    <form onSubmit={submit} className="space-y-3 px-4 pb-4">
      <p className="text-xs text-muted-foreground">
        Hashtag channels are public but discoverable only if you know the
        tag. The PSK is derived from the channel name, so leave the secret
        empty.
      </p>
      <div className="space-y-1">
        <Label htmlFor="join-hashtag-name">Hashtag</Label>
        <Input
          id="join-hashtag-name"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          maxLength={32}
          autoFocus
          aria-invalid={!valid && raw !== "#" ? true : undefined}
          placeholder="#example"
          required
        />
        {!valid && raw !== "#" && (
          <p className="text-xs text-destructive">
            Use #letters, digits or underscores only.
          </p>
        )}
      </div>
      {slotFull && (
        <p className="text-xs text-destructive">
          All channel slots are in use. Remove a channel first.
        </p>
      )}
      <Button type="submit" disabled={add.isPending || slotFull || !valid}>
        {add.isPending ? "Joining…" : "Join hashtag"}
      </Button>
    </form>
  )
}
