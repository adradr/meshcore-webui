import { useState } from "react"
import { Link } from "react-router-dom"
import { Copy, MapPin, Radio, Send, Waves } from "lucide-react"
import { toast } from "sonner"
import {
  useDeviceInfo,
  useSelfInfo,
  useSendAdvert,
} from "@/features/device/queries"
import { NoiseWidget } from "@/features/noise/NoiseWidget"
import { useRealtime } from "@/realtime/WebSocketProvider"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"

function truncatePubKey(pk: string): string {
  if (pk.length <= 16) return pk
  return `${pk.slice(0, 8)}…${pk.slice(-8)}`
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      toast.success(`${label} copied`)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error("Clipboard unavailable")
    }
  }
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      className="h-7 w-7"
      onClick={onCopy}
      aria-label={`Copy ${label}`}
    >
      <Copy className={`h-3.5 w-3.5 ${copied ? "text-green-500" : ""}`} />
    </Button>
  )
}

function KeyValue({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-sm font-medium tabular-nums">{children}</span>
    </div>
  )
}

function ConnectionBadge() {
  const { status } = useRealtime()
  const isConnected = status === "open"
  return (
    <Badge
      variant={isConnected ? "default" : "destructive"}
      className={isConnected ? "bg-green-600 hover:bg-green-600" : ""}
    >
      {isConnected ? "Connected" : status}
    </Badge>
  )
}

function IdentityCard() {
  const { data: self, isLoading } = useSelfInfo()
  const { data: info } = useDeviceInfo()

  const fwVersion = info?.ver ?? (info ? "—" : undefined)
  const fwBuild = info?.fw_build
  const fwLine =
    fwVersion && fwBuild
      ? `${fwVersion} (built ${fwBuild})`
      : (fwVersion ?? "—")

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Identity</CardTitle>
        <ConnectionBadge />
      </CardHeader>
      <CardContent className="space-y-1">
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <>
            <KeyValue label="Name">{self?.name ?? "—"}</KeyValue>
            <Separator />
            <div className="flex items-center justify-between gap-2 py-1">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                Public key
              </span>
              <div className="flex items-center gap-1">
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                  {self?.public_key
                    ? truncatePubKey(self.public_key)
                    : "—"}
                </code>
                {self?.public_key && (
                  <CopyButton value={self.public_key} label="Public key" />
                )}
              </div>
            </div>
            <Separator />
            <KeyValue label="Model">{info?.model ?? "—"}</KeyValue>
            <Separator />
            <KeyValue label="Firmware">{fwLine ?? "—"}</KeyValue>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function RadioCard() {
  const { data: self, isLoading } = useSelfInfo()
  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 space-y-0">
        <Radio className="h-4 w-4 text-muted-foreground" />
        <CardTitle className="text-base">Radio</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <>
            <KeyValue label="Frequency">
              {self?.radio_freq != null ? `${self.radio_freq} MHz` : "—"}
            </KeyValue>
            <Separator />
            <KeyValue label="Bandwidth">
              {self?.radio_bw != null ? `${self.radio_bw} kHz` : "—"}
            </KeyValue>
            <Separator />
            <KeyValue label="Spreading factor">
              {self?.radio_sf ?? "—"}
            </KeyValue>
            <Separator />
            <KeyValue label="Coding rate">
              {self?.radio_cr != null ? `${self.radio_cr} (4/${self.radio_cr})` : "—"}
            </KeyValue>
            <Separator />
            <KeyValue label="TX power">
              {self?.tx_power != null
                ? `${self.tx_power} / ${self.max_tx_power ?? "?"} dBm`
                : "—"}
            </KeyValue>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function HardwareCard() {
  const { data: info, isLoading } = useDeviceInfo()
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Hardware</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : (
          <>
            <KeyValue label="Max contacts">{info?.max_contacts ?? "—"}</KeyValue>
            <Separator />
            <KeyValue label="Max channels">{info?.max_channels ?? "—"}</KeyValue>
            {info?.ble_pin != null && info.ble_pin !== 0 && (
              <>
                <Separator />
                <KeyValue label="BLE pin">{info.ble_pin}</KeyValue>
              </>
            )}
            <Separator />
            <KeyValue label="Repeat mode">
              {info?.repeat ? "On" : "Off"}
            </KeyValue>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function PositionCard() {
  const { data: self, isLoading } = useSelfInfo()
  const hasPosition = self?.adv_lat != null && self?.adv_lon != null
  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 space-y-0">
        <MapPin className="h-4 w-4 text-muted-foreground" />
        <CardTitle className="text-base">Position</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : hasPosition ? (
          <>
            <KeyValue label="Latitude">{self?.adv_lat?.toFixed(5)}</KeyValue>
            <Separator />
            <KeyValue label="Longitude">{self?.adv_lon?.toFixed(5)}</KeyValue>
            <p className="pt-1 text-xs text-muted-foreground">
              decimal degrees ·{" "}
              <Link to="/map" className="underline hover:text-foreground">
                view on map
              </Link>
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            No position set on this device.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function ActionsCard() {
  const advert = useSendAdvert()
  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 space-y-0">
        <Waves className="h-4 w-4 text-muted-foreground" />
        <CardTitle className="text-base">Actions</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 sm:flex-row">
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          onClick={() => advert.mutate(false)}
          disabled={advert.isPending}
        >
          <Send className="mr-1 h-4 w-4" />
          Send Advert
        </Button>
        <Button
          type="button"
          className="flex-1"
          onClick={() => advert.mutate(true)}
          disabled={advert.isPending}
        >
          <Waves className="mr-1 h-4 w-4" />
          Send Flood Advert
        </Button>
      </CardContent>
    </Card>
  )
}

export function DevicePage() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
        <IdentityCard />
        <RadioCard />
        <HardwareCard />
        <PositionCard />
        <ActionsCard />
        <NoiseWidget />
      </div>
    </div>
  )
}
