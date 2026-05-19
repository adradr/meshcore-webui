import { AlertCircle, Check, CheckCheck, Loader2 } from "lucide-react"

/**
 * Returns the per-state icon + tone class. Text labels are dropped in favor
 * of icons (iMessage / WhatsApp idiom). The state is shown only on the
 * latest outgoing message in a conversation — callers decide visibility.
 *
 * The outer span is keyed on `state` so React remounts on transitions and
 * the Tailwind `animate-in fade-in` cross-fades each new icon in.
 */
export function MessageStatusIcon({ state }: { state: string }) {
  const icon = (() => {
    switch (state) {
      case "sending":
        return <Loader2 className="h-3 w-3 animate-spin opacity-70" aria-label="Sending" />
      case "pending":
        return <Check className="h-3 w-3 opacity-70" aria-label="Sent" />
      case "acked":
        return <CheckCheck className="h-3 w-3 text-blue-400" aria-label="Delivered" />
      case "failed":
        return <AlertCircle className="h-3 w-3 text-destructive" aria-label="Failed" />
      default:
        return null
    }
  })()
  if (!icon) return null
  return (
    <span key={state} className="inline-flex animate-in fade-in duration-200">
      {icon}
    </span>
  )
}
