import { useEffect, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { Copy, Cpu, Crosshair, MapPin, Send, Waves } from "lucide-react"
import { toast } from "sonner"
import {
  useDeviceInfo,
  useDeviceStatus,
  useSelfInfo,
  useSendAdvert,
  useSetPosition,
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
import { PositionPicker } from "@/components/map/PositionPicker"

const VALID_TABS = ["overview", "radio", "behaviour", "rx-log", "noise"] as const
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
  // Two independent links matter: browser↔server (WS) and server↔radio
  // (TCP companion port). The user-facing 'Connected' badge MUST reflect
  // the radio link — that's what they care about. The WS being open while
  // the radio is down was the pre-1.9 source of misleading "Connected"
  // when /api/device/info was 500ing.
  const { status: wsStatus } = useRealtime()
  const device = useDeviceStatus()
  const radioConnected = device.data?.connected === true
  const wsOpen = wsStatus === "open"
  if (!wsOpen) {
    return <Badge variant="destructive">WebUI offline</Badge>
  }
  if (radioConnected) {
    return (
      <Badge variant="default" className="bg-green-600 hover:bg-green-600">
        Connected
      </Badge>
    )
  }
  return <Badge variant="destructive">Radio disconnected</Badge>
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

/**
 * Editable lat/lon card. Two modes:
 *  - view  → current position from self-info (or "no position set")
 *  - edit  → two numeric inputs, "use my location" prefill, Save / Cancel.
 *
 * Save calls POST /api/device/position which persists to flash and the
 * value re-appears in subsequent advertisements. The mutation invalidates
 * the self-info query so the view-mode card refreshes automatically.
 */
function PositionCard() {
  const { data: self, isLoading } = useSelfInfo()
  const setPosition = useSetPosition()
  const hasPosition = self?.adv_lat != null && self?.adv_lon != null

  const [editing, setEditing] = useState(false)
  const [latText, setLatText] = useState("")
  const [lonText, setLonText] = useState("")
  const [geoBusy, setGeoBusy] = useState(false)

  // Seed inputs from self-info whenever we open the editor or self-info
  // refreshes. Done in an effect to handle the (common) case where the
  // card mounts before self-info has resolved.
  useEffect(() => {
    if (!editing) return
    if (latText === "" && self?.adv_lat != null) {
      setLatText(self.adv_lat.toString())
    }
    if (lonText === "" && self?.adv_lon != null) {
      setLonText(self.adv_lon.toString())
    }
    // We intentionally only re-seed empty fields so user edits are not
    // overwritten by a self-info refetch mid-edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, self?.adv_lat, self?.adv_lon])

  const startEdit = () => {
    setLatText(self?.adv_lat != null ? self.adv_lat.toString() : "")
    setLonText(self?.adv_lon != null ? self.adv_lon.toString() : "")
    setEditing(true)
  }

  const cancelEdit = () => {
    setEditing(false)
    setLatText("")
    setLonText("")
  }

  const parsed = (() => {
    const lat = Number.parseFloat(latText)
    const lon = Number.parseFloat(lonText)
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
    if (lat < -90 || lat > 90) return null
    if (lon < -180 || lon > 180) return null
    return { lat, lon }
  })()

  const useMyLocation = () => {
    if (!("geolocation" in navigator)) {
      toast.error("Geolocation not supported in this browser")
      return
    }
    setGeoBusy(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLatText(pos.coords.latitude.toFixed(6))
        setLonText(pos.coords.longitude.toFixed(6))
        setGeoBusy(false)
      },
      (err) => {
        setGeoBusy(false)
        toast.error(
          err.code === err.PERMISSION_DENIED
            ? "Location permission denied"
            : "Could not get current location",
        )
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    )
  }

  const onSave = () => {
    if (!parsed) return
    setPosition.mutate(parsed, {
      onSuccess: () => {
        setEditing(false)
        setLatText("")
        setLonText("")
      },
    })
  }

  const saving = setPosition.isPending

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base">Position</CardTitle>
        </div>
        {!editing && !isLoading && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={startEdit}
            aria-label="Edit position"
          >
            Edit
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : editing ? (
          <div className="flex flex-col gap-3">
            <PositionPicker
              lat={parsed?.lat ?? null}
              lon={parsed?.lon ?? null}
              onPick={(la, lo) => {
                setLatText(la.toString())
                setLonText(lo.toString())
              }}
            />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor="position-lat" className="text-xs uppercase tracking-wide text-muted-foreground">
                  Latitude
                </Label>
                <Input
                  id="position-lat"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min={-90}
                  max={90}
                  placeholder="-90 to 90"
                  value={latText}
                  onChange={(e) => setLatText(e.target.value)}
                  disabled={saving}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="position-lon" className="text-xs uppercase tracking-wide text-muted-foreground">
                  Longitude
                </Label>
                <Input
                  id="position-lon"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min={-180}
                  max={180}
                  placeholder="-180 to 180"
                  value={lonText}
                  onChange={(e) => setLonText(e.target.value)}
                  disabled={saving}
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={useMyLocation}
                disabled={saving || geoBusy}
              >
                <Crosshair className="mr-1 h-4 w-4" />
                {geoBusy ? "Locating…" : "Use my location"}
              </Button>
              <div className="ml-auto flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={cancelEdit}
                  disabled={saving}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={onSave}
                  disabled={saving || parsed === null}
                >
                  {saving ? "Saving…" : "Save"}
                </Button>
              </div>
            </div>
            {latText !== "" && lonText !== "" && parsed === null && (
              <p className="text-xs text-destructive">
                Latitude must be -90..90 and longitude -180..180.
              </p>
            )}
          </div>
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
    : "overview"

  const handleTabChange = (value: string) => {
    if (!isDeviceTab(value)) return
    const next = new URLSearchParams(searchParams)
    if (value === "overview") {
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
            <TabsTrigger value="overview" className="flex-1">
              Overview
            </TabsTrigger>
            <TabsTrigger value="radio" className="flex-1">
              Radio
            </TabsTrigger>
            <TabsTrigger value="behaviour" className="flex-1">
              Behaviour
            </TabsTrigger>
            <TabsTrigger value="rx-log" className="flex-1">
              RX Log
            </TabsTrigger>
            <TabsTrigger value="noise" className="flex-1">
              Noise
            </TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="mt-0">
            <DeviceInfoPanel />
          </TabsContent>
          <TabsContent value="radio" className="mt-0">
            <div className="rounded-lg border border-dashed border-muted p-8 text-center text-sm text-muted-foreground">
              Radio configuration — coming soon
            </div>
          </TabsContent>
          <TabsContent value="behaviour" className="mt-0">
            <div className="rounded-lg border border-dashed border-muted p-8 text-center text-sm text-muted-foreground">
              Behaviour settings — coming soon
            </div>
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
