import { useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { Copy, Cpu, MapPin, Send, Waves } from "lucide-react"
import { toast } from "sonner"
import {
  useDeviceInfo,
  useSelfInfo,
  useSendAdvert,
} from "@/features/device/queries"
import { RxLogPanel } from "@/features/rx_log/RxLogPanel"
import { NoisePanel } from "@/features/noise/NoisePanel"
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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import { PageShell } from "@/components/page-shell"
import { PageHeader } from "@/components/page-header"

const VALID_TABS = ["info", "rx-log", "noise"] as const
type DeviceTab = (typeof VALID_TABS)[number]

function isDeviceTab(value: string | null): value is DeviceTab {
  return value !== null && (VALID_TABS as readonly string[]).includes(value)
}

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

/**
 * Single compact card combining Identity + Hardware + Radio. Was three
 * separate cards stacked vertically; collapsing them halves the vertical
 * noise on the Info tab without losing any data.
 *
 * Layout is a 2-column `<dl>` so label/value alignment stays consistent and
 * long values (pubkey, radio line) truncate gracefully on narrow viewports.
 */
function DeviceInfoCard() {
  const { data: self, isLoading: selfLoading } = useSelfInfo()
  const { data: info, isLoading: infoLoading } = useDeviceInfo()
  const isLoading = selfLoading || infoLoading

  const fwVersion = info?.ver
  const fwBuild = info?.fw_build
  const fwLine =
    fwVersion && fwBuild
      ? `${fwVersion} (${fwBuild})`
      : (fwVersion ?? "—")

  const radioLine =
    self?.radio_freq != null
      ? [
          `${self.radio_freq} MHz`,
          self.radio_sf != null ? `SF${self.radio_sf}` : null,
          self.radio_bw != null ? `BW${self.radio_bw} kHz` : null,
          self.radio_cr != null ? `CR4/${self.radio_cr}` : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : "—"

  const txPowerLine =
    self?.tx_power != null
      ? `${self.tx_power}/${self.max_tx_power ?? "?"} dBm`
      : "—"

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 p-3 pb-2">
        <div className="flex items-center gap-2">
          <Cpu className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base">Device</CardTitle>
        </div>
        <ConnectionBadge />
      </CardHeader>
      <CardContent className="p-3 pt-2">
        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">Name</dt>
            <dd className="truncate font-medium">{self?.name ?? "—"}</dd>

            <dt className="text-muted-foreground">Public key</dt>
            <dd className="flex min-w-0 items-center gap-1">
              <code className="truncate font-mono text-xs">
                {self?.public_key
                  ? truncatePubKey(self.public_key)
                  : "—"}
              </code>
              {self?.public_key && (
                <CopyButton value={self.public_key} label="Public key" />
              )}
            </dd>

            <dt className="text-muted-foreground">Model</dt>
            <dd className="truncate">{info?.model ?? "—"}</dd>

            <dt className="text-muted-foreground">Firmware</dt>
            <dd className="truncate">{fwLine}</dd>

            <dt className="text-muted-foreground">Radio</dt>
            <dd className="truncate">{radioLine}</dd>

            <dt className="text-muted-foreground">TX power</dt>
            <dd>{txPowerLine}</dd>

            {info?.max_contacts != null && (
              <>
                <dt className="text-muted-foreground">Max contacts</dt>
                <dd>{info.max_contacts}</dd>
              </>
            )}
            {info?.max_channels != null && (
              <>
                <dt className="text-muted-foreground">Max channels</dt>
                <dd>{info.max_channels}</dd>
              </>
            )}
            {info?.ble_pin != null && info.ble_pin !== 0 && (
              <>
                <dt className="text-muted-foreground">BLE pin</dt>
                <dd>{info.ble_pin}</dd>
              </>
            )}
            {info?.repeat != null && (
              <>
                <dt className="text-muted-foreground">Repeat mode</dt>
                <dd>{info.repeat ? "On" : "Off"}</dd>
              </>
            )}
          </dl>
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
      {/*
        Mobile-first: stack vertically with comfortable tap heights (h-11 ≈
        44pt, the Apple HIG minimum) and shrink back to default height side-
        by-side on sm+. Was h-9 stacked, which read as visually cramped.
      */}
      {/*
        Always stacked, always h-11. The previous `sm:flex-row` side-by-side
        layout caused "Send Flood Advert" to wrap inside its h-9 button on
        narrow viewports — text on two lines crammed into 36px reads as
        vertically squeezed. Stacking gives each button comfortable 44pt
        height (Apple HIG) without competing for horizontal room.
      */}
      <CardContent className="flex flex-col gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-11"
          onClick={() => advert.mutate(false)}
          disabled={advert.isPending}
        >
          <Send className="mr-1 h-4 w-4" />
          Send Advert
        </Button>
        <Button
          type="button"
          className="h-11"
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

function DeviceInfoPanel() {
  return (
    <div className="flex flex-col gap-4">
      <DeviceInfoCard />
      <PositionCard />
      <ActionsCard />
    </div>
  )
}

export function DevicePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedTab = searchParams.get("tab")
  const activeTab: DeviceTab = isDeviceTab(requestedTab)
    ? requestedTab
    : "info"

  const handleTabChange = (value: string) => {
    if (!isDeviceTab(value)) return
    const next = new URLSearchParams(searchParams)
    if (value === "info") {
      next.delete("tab")
    } else {
      next.set("tab", value)
    }
    setSearchParams(next, { replace: true })
  }

  return (
    <PageShell header={<PageHeader title="Device" />}>
      <div className="mx-auto flex h-full max-w-3xl flex-col">
        <Tabs
          value={activeTab}
          onValueChange={handleTabChange}
          className="flex h-full flex-col gap-4"
        >
          <TabsList className="sticky top-0 z-10 w-full self-stretch">
            <TabsTrigger value="info" className="flex-1">
              Info
            </TabsTrigger>
            <TabsTrigger value="rx-log" className="flex-1">
              RX Log
            </TabsTrigger>
            <TabsTrigger value="noise" className="flex-1">
              Noise
            </TabsTrigger>
          </TabsList>
          <TabsContent value="info" className="mt-0">
            <DeviceInfoPanel />
          </TabsContent>
          <TabsContent
            value="rx-log"
            className="mt-0 min-h-0 flex-1 data-[state=inactive]:hidden"
            forceMount
          >
            <RxLogPanel />
          </TabsContent>
          <TabsContent
            value="noise"
            className="mt-0 min-h-0 flex-1 data-[state=inactive]:hidden"
            forceMount
          >
            <NoisePanel />
          </TabsContent>
        </Tabs>
      </div>
    </PageShell>
  )
}
