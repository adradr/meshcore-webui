import { AlertCircle, Check, CheckCheck, Loader2 } from "lucide-react"

interface StatusVisual {
  text: string
  icon: React.ReactNode
  tone: "muted" | "destructive"
}

export function getStatusVisual(state: string): StatusVisual | null {
  switch (state) {
    case "sending":
      return {
        text: "Sending",
        icon: <Loader2 className="h-3 w-3 animate-spin" />,
        tone: "muted",
      }
    case "pending":
      return {
        text: "Sent",
        icon: <Check className="h-3 w-3" />,
        tone: "muted",
      }
    case "acked":
      return {
        text: "Acked",
        icon: <CheckCheck className="h-3 w-3" />,
        tone: "muted",
      }
    case "failed":
      return {
        text: "Failed",
        icon: <AlertCircle className="h-3 w-3" />,
        tone: "destructive",
      }
    default:
      return null
  }
}

export function MessageStatusBadge({ state }: { state: string }) {
  const v = getStatusVisual(state)
  if (!v) return null
  const cls = v.tone === "destructive" ? "text-destructive" : "opacity-70"
  return (
    <span className={`flex items-center gap-1 text-[10px] ${cls}`} title={v.text}>
      {v.icon}
      <span>{v.text}</span>
    </span>
  )
}
