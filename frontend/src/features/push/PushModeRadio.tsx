import { toast } from "sonner"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { notifyError } from "@/lib/notify"
import {
  usePushMode,
  useSetPushMode,
  type PushMode,
} from "@/features/push/queries"

/**
 * Global push-mode picker (all / mentions / mute).
 *
 * Server-wide setting — applies to every subscribed device. Per-conversation
 * mutes layer ON TOP of this and only take effect when mode is "all".
 */
export function PushModeRadio() {
  const pushMode = usePushMode()
  const setPushMode = useSetPushMode()
  const current: PushMode = pushMode.data?.mode ?? "all"
  const disabled = pushMode.isLoading || setPushMode.isPending

  const onChange = (v: string) => {
    setPushMode.mutate(v as PushMode, {
      onSuccess: () => toast.success("Push filter saved"),
      onError: (e) => notifyError("Push filter save", e),
    })
  }

  return (
    <RadioGroup
      value={current}
      onValueChange={onChange}
      className="gap-3"
      disabled={disabled}
    >
      <div className="flex items-start gap-2">
        <RadioGroupItem value="all" id="push-mode-all" className="mt-0.5" />
        <div className="grid gap-0.5">
          <Label htmlFor="push-mode-all">All messages</Label>
          <p className="text-xs text-muted-foreground">
            Default — push for every inbound message (subject to per-conversation
            mutes).
          </p>
        </div>
      </div>
      <div className="flex items-start gap-2">
        <RadioGroupItem
          value="mentions"
          id="push-mode-mentions"
          className="mt-0.5"
        />
        <div className="grid gap-0.5">
          <Label htmlFor="push-mode-mentions">@-mentions only</Label>
          <p className="text-xs text-muted-foreground">
            Push only when your device name appears in a channel message. DMs
            always push.
          </p>
        </div>
      </div>
      <div className="flex items-start gap-2">
        <RadioGroupItem value="mute" id="push-mode-mute" className="mt-0.5" />
        <div className="grid gap-0.5">
          <Label htmlFor="push-mode-mute">Mute all</Label>
          <p className="text-xs text-muted-foreground">
            Global silence. Overrides per-conversation settings.
          </p>
        </div>
      </div>
    </RadioGroup>
  )
}
