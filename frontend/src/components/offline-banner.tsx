import { WifiOff } from "lucide-react"
import { useOnlineStatus } from "@/realtime/useOnlineStatus"
import { useRealtime } from "@/realtime/WebSocketProvider"
import { useDeviceStatus } from "@/features/device/queries"
import { Alert, AlertDescription } from "@/components/ui/alert"

export function OfflineBanner() {
  const online = useOnlineStatus()
  const { status: wsStatus } = useRealtime()
  // Polled /api/device/status — never raises, returns connected:false
  // when the radio link is down. The previous implementation read from
  // the react-query cache populated by WS push events, but if the
  // backend never connects at all (e.g. radio offline at boot) no event
  // is emitted and the cache stays undefined — defaulting to "connected"
  // produced a misleading green badge. Polling fixes that.
  const device = useDeviceStatus({ refetchIntervalMs: 5_000 })
  const radioKnown = device.data !== undefined
  const radioConnected = device.data?.connected === true
  const wsDown = wsStatus !== "open"

  // Treat "no first response yet" as no-banner to avoid a flash on first
  // paint. Once the first poll lands, the real state takes over.
  if (online && !wsDown && (!radioKnown || radioConnected)) return null

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
