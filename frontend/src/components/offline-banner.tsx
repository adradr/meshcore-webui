import { WifiOff } from "lucide-react"
import { useOnlineStatus } from "@/realtime/useOnlineStatus"
import { useRealtime } from "@/realtime/WebSocketProvider"
import { Alert, AlertDescription } from "@/components/ui/alert"

export function OfflineBanner() {
  const online = useOnlineStatus()
  const { status } = useRealtime()
  const wsDown = status !== "open"

  if (online && !wsDown) return null

  const message = !online
    ? "You are offline. Changes will sync when reconnected."
    : "Reconnecting to MeshCore..."

  return (
    <Alert variant="default" className="rounded-none border-x-0 border-t-0">
      <WifiOff className="h-4 w-4" />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  )
}
