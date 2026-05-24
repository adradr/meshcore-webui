/**
 * Reusable mute/unmute button for a single conversation.
 *
 * Keeps display + behaviour in one place so the contact-detail page,
 * channels list, conversation header, and settings list all use the same
 * affordance and feedback copy.
 */
import { Bell, BellOff, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { useHaptic } from "@/haptics/HapticProvider"
import { notifyError } from "@/lib/notify"
import { useIsMuted, useToggleMute, type MuteKind } from "./queries"

interface Props {
  kind: MuteKind
  /** Stable key: contact pubkey/prefix for "contact", channel idx as string for "channel". */
  targetKey: string
  /** Display name surfaced in the toast — falls back to the kind word. */
  name?: string
  size?: "icon" | "sm" | "default"
  /** Pass-through className for layout positioning. */
  className?: string
}

export function MuteToggle({
  kind,
  targetKey,
  name,
  size = "icon",
  className,
}: Props) {
  const muted = useIsMuted(kind, targetKey)
  const toggle = useToggleMute()
  const haptic = useHaptic()
  const Icon = muted ? BellOff : Bell
  const label = muted ? "Unmute notifications" : "Mute notifications"

  return (
    <Button
      type="button"
      size={size}
      variant={muted ? "secondary" : "ghost"}
      title={label}
      aria-label={label}
      aria-pressed={muted}
      className={className}
      disabled={toggle.isPending}
      onClick={(e) => {
        // Stop propagation so the toggle inside clickable cards doesn't
        // navigate (e.g. on the channels list).
        e.stopPropagation()
        haptic.tap()
        toggle.mutate(
          { kind, key: targetKey, muted: !muted },
          {
            onSuccess: () =>
              toast.success(
                muted
                  ? `Unmuted ${name ?? kind}`
                  : `Muted ${name ?? kind} — push notifications off`,
              ),
            onError: (err) => notifyError(muted ? "Unmute" : "Mute", err),
          },
        )
      }}
    >
      {toggle.isPending ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Icon className="h-4 w-4" />
      )}
    </Button>
  )
}
