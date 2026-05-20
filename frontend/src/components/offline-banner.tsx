import { WifiOff } from "lucide-react"
import { useSyncExternalStore } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useOnlineStatus } from "@/realtime/useOnlineStatus"
import { useRealtime } from "@/realtime/WebSocketProvider"
import { Alert, AlertDescription } from "@/components/ui/alert"

interface DeviceStatus {
  connected: boolean
}

export function OfflineBanner() {
  const online = useOnlineStatus()
  const { status: wsStatus } = useRealtime()
  const qc = useQueryClient()
  // The backend emits `connected` / `disconnected` system events on its TCP
  // link to the MeshCore radio — independent of the browser↔server WS.
  // Subscribe to the query cache rather than firing a query, since this
  // value is push-only (only the WS handler ever writes it).
  const radioConnected = useSyncExternalStore(
    (notify) =>
      qc.getQueryCache().subscribe((e) => {
        if (e.query.queryKey[0] === "device" && e.query.queryKey[1] === "status")
          notify()
      }),
    () =>
      (qc.getQueryData<DeviceStatus>(["device", "status"])?.connected ?? true),
  )

  const wsDown = wsStatus !== "open"

  if (online && !wsDown && radioConnected) return null

  // Priority: browser offline > WebUI link down > radio link down.
  // Showing the most upstream failure keeps the message accurate; downstream
  // states are unknowable while the upstream layer is broken.
  const message = !online
    ? "You're offline — changes will sync when you reconnect."
    : wsDown
      ? "Reconnecting to the WebUI service…"
      : "Mesh radio disconnected — retrying…"

  return (
    <Alert variant="default" className="rounded-none border-x-0 border-t-0">
      <WifiOff className="h-4 w-4" />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  )
}
