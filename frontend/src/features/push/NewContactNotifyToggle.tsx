import { toast } from "sonner"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { notifyError } from "@/lib/notify"
import {
  useNewContactNotify,
  useSetNewContactNotify,
} from "@/features/push/queries"

/**
 * Toggle for "new contact discovered" push notifications.
 *
 * Server-wide opt-in (default off). When on, the backend sends one push per
 * newly discovered contact. Global "Mute all" still silences these.
 */
export function NewContactNotifyToggle() {
  const q = useNewContactNotify()
  const set = useSetNewContactNotify()
  const checked = q.data?.enabled ?? false
  const disabled = q.isLoading || set.isPending

  const onChange = (v: boolean) => {
    set.mutate(v, {
      onSuccess: () => toast.success("New-contact alerts saved"),
      onError: (e) => notifyError("New-contact alerts save", e),
    })
  }

  return (
    <div className="flex items-start gap-2">
      <Switch
        id="new-contact-notify"
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        className="mt-0.5"
      />
      <div className="grid gap-0.5">
        <Label htmlFor="new-contact-notify">New contact alerts</Label>
        <p className="text-xs text-muted-foreground">
          Push when the device discovers a new contact. Off by default; a busy
          mesh can discover many at once.
        </p>
      </div>
    </div>
  )
}
