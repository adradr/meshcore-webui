import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { notifyError } from "@/lib/notify"
import {
  useAddChannel,
  useChannels,
} from "@/features/channels/queries"

/**
 * Two-step confirmation for joining the public channel. The public channel
 * is always slot 0 with name `"public"` and `psk: null` (the firmware
 * derives the shared public PSK on its own).
 *
 * When idx=0 is already occupied we require an extra confirmation click
 * because the device's set_channel command will overwrite the existing
 * entry without asking.
 */
export function JoinPublicConfirm({ onSuccess }: { onSuccess: () => void }) {
  const { data } = useChannels()
  const add = useAddChannel()
  const slot0 = (data ?? []).find((ch) => ch.channel_idx === 0)
  const [confirmedOverwrite, setConfirmedOverwrite] = useState(false)

  const willOverwrite =
    slot0 !== undefined && slot0.channel_name?.toLowerCase() !== "public"

  const submit = () => {
    if (willOverwrite && !confirmedOverwrite) {
      setConfirmedOverwrite(true)
      return
    }
    add.mutate(
      { idx: 0, name: "public", psk: null },
      {
        onSuccess: () => {
          toast.success("Joined the public channel")
          onSuccess()
        },
        onError: (err) => notifyError("Join public", err),
      },
    )
  }

  return (
    <div className="space-y-3 px-4 pb-4 text-sm">
      <p className="text-muted-foreground">
        The public channel is open to every MeshCore node on the mesh. It
        always uses slot #0 with the firmware-derived public secret.
      </p>
      {willOverwrite && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs">
          <p className="font-medium text-destructive">
            Slot #0 is currently used by{" "}
            <span className="font-mono">
              {slot0?.channel_name ?? "(unnamed)"}
            </span>
            .
          </p>
          <p className="mt-1 text-muted-foreground">
            Joining the public channel will overwrite that slot. This cannot
            be undone.
          </p>
          {confirmedOverwrite && (
            <p className="mt-1 font-medium text-destructive">
              Click again to confirm.
            </p>
          )}
        </div>
      )}
      <Button
        type="button"
        onClick={submit}
        disabled={add.isPending}
        variant={willOverwrite ? "destructive" : "default"}
      >
        {add.isPending
          ? "Joining…"
          : willOverwrite && !confirmedOverwrite
            ? "Overwrite slot #0"
            : willOverwrite
              ? "Confirm overwrite"
              : "Join public channel"}
      </Button>
    </div>
  )
}
