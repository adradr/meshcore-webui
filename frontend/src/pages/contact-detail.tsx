import { useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import {
  ArrowLeft,
  Compass,
  Copy,
  Loader2,
  MapPin,
  MessageCircle,
  Navigation,
  Radio,
  Route,
  Share2,
  Shield,
  Star,
  Thermometer,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"
import {
  useContact,
  useContacts,
  useDeleteContact,
  useDiscoverPath,
  usePingContact,
  useRequestACL,
  useRequestTelemetry,
  useResetPath,
  useSetFlags,
  useShareContact,
  type Contact,
} from "@/features/contacts/queries"
import { isMessageableContact } from "@/features/contacts/types"
import { useSelfInfo, type SelfInfo } from "@/features/device/queries"
import { parseRepeaterPath } from "@/features/chat/repeaterPath"
import { formatLastSeen } from "@/features/rx_log/format"
import { ContactAvatar } from "@/components/contact-avatar"
import { MuteToggle } from "@/features/mutes/MuteToggle"
import { LinkDiagnosticPanel } from "@/features/diagnostics/LinkDiagnosticPanel"
import { TraceMonitorPanel } from "@/features/trace/monitor/TraceMonitorPanel"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { PageShell } from "@/components/page-shell"
import { PageHeader } from "@/components/page-header"
import {
  bearingDeg,
  compassDir,
  formatDistance,
  haversineKm,
} from "@/lib/geo"

const STAR_FLAG = 0x01
const TEL_LOC_FLAG = 0x02
const TEL_ENV_FLAG = 0x04

const NODE_TYPE_LABEL: Record<number, string> = {
  1: "Companion (CLI)",
  2: "Repeater",
  3: "Room server",
  4: "Sensor",
}

const NODE_TYPE_BADGE: Record<number, string> = {
  1: "Companion",
  2: "Repeater",
  3: "Room",
  4: "Sensor",
}

function hasGps(lat?: number | null, lon?: number | null): boolean {
  return (
    lat != null &&
    lon != null &&
    !(Math.abs(lat) < 0.0001 && Math.abs(lon) < 0.0001)
  )
}

function computeDistance(contact: Contact, self: SelfInfo | undefined): string | null {
  if (!self) return null
  if (!hasGps(contact.adv_lat, contact.adv_lon)) return null
  if (!hasGps(self.adv_lat, self.adv_lon)) return null
  const km = haversineKm(
    self.adv_lat!,
    self.adv_lon!,
    contact.adv_lat!,
    contact.adv_lon!,
  )
  const bearing = bearingDeg(
    self.adv_lat!,
    self.adv_lon!,
    contact.adv_lat!,
    contact.adv_lon!,
  )
  return `${formatDistance(km)} · ${compassDir(bearing)}`
}

function pathString(contact: Contact): string | null | undefined {
  const raw = contact.out_path ?? contact.path
  if (raw === "" || raw === null || raw === undefined) return raw ?? null
  return raw
}

interface RowProps {
  label: string
  children: React.ReactNode
}

function Row({ label, children }: RowProps) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="flex flex-wrap items-center justify-end gap-1.5 text-sm font-medium tabular-nums">
        {children}
      </span>
    </div>
  )
}

interface ActionTileProps {
  icon: React.ComponentType<{ className?: string }>
  label: string
  onClick: () => void
  loading?: boolean
  disabled?: boolean
}

function ActionTile({ icon: Icon, label, onClick, loading, disabled }: ActionTileProps) {
  return (
    <Button
      variant="outline"
      type="button"
      className="h-auto min-h-[4.5rem] flex-col gap-1.5 py-3"
      onClick={onClick}
      disabled={disabled || loading}
    >
      {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Icon className="h-5 w-5" />}
      <span className="text-[11px] font-medium">{label}</span>
    </Button>
  )
}

function CopyButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      toast.success(label ? `${label} copied` : "Copied")
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error("Copy failed")
    }
  }
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-6 w-6"
      onClick={handleCopy}
      aria-label={label ? `Copy ${label.toLowerCase()}` : "Copy"}
    >
      <Copy className={`h-3 w-3 ${copied ? "text-green-500" : ""}`} />
    </Button>
  )
}

function SkeletonView() {
  return (
    <PageShell header={<PageHeader title="Contact" />}>
      <div className="mx-auto max-w-3xl space-y-4">
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-28 w-full rounded-xl" />
        {/* 2-col on phones (each tile ≥150px wide → label never wraps),
            4-col on sm+ when there's room. min-h keeps icon+label centred
            comfortably even when the label fits on one line. */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-24 w-full rounded-xl" />
      </div>
    </PageShell>
  )
}

function NotFoundView({ pubkey }: { pubkey?: string }) {
  const navigate = useNavigate()
  const backButton = (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => navigate(-1)}
      aria-label="Back"
    >
      <ArrowLeft className="h-5 w-5" />
    </Button>
  )
  return (
    <PageShell
      header={<PageHeader title="Contact (not found)" leftAction={backButton} />}
    >
      <div className="mx-auto max-w-3xl space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Contact not found</CardTitle>
            <CardDescription>
              {pubkey ? (
                <>
                  No contact with pubkey{" "}
                  <code className="text-xs">{`${pubkey.slice(0, 12)}…`}</code>{" "}
                  exists on this device.
                </>
              ) : (
                "No pubkey provided."
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" size="sm">
              <Link to="/contacts">Back to contacts</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </PageShell>
  )
}

export function ContactDetailPage() {
  const { pubKey } = useParams<{ pubKey: string }>()
  const navigate = useNavigate()
  const { contact, isLoading } = useContact(pubKey)
  const { data: allContacts } = useContacts()
  const { data: selfInfo } = useSelfInfo()

  const [shareOpen, setShareOpen] = useState(false)
  const [shareUri, setShareUri] = useState("")
  const [telemetryOpen, setTelemetryOpen] = useState(false)
  const [telemetryData, setTelemetryData] = useState<unknown>(null)
  const [aclData, setAclData] = useState<unknown>(null)

  const flags = useSetFlags()
  const removeContact = useDeleteContact()
  const share = useShareContact()
  const tel = useRequestTelemetry()
  const ping = usePingContact()
  const acl = useRequestACL()
  const discoverPath = useDiscoverPath()
  const resetPath = useResetPath()

  if (isLoading) return <SkeletonView />
  if (!contact || !pubKey) return <NotFoundView pubkey={pubKey} />

  const displayName = contact.adv_name ?? pubKey.slice(0, 8)
  const flagsValue = contact.flags ?? 0
  const isStarred = Boolean(flagsValue & STAR_FLAG)
  const hasLocTelemetry = Boolean(flagsValue & TEL_LOC_FLAG)
  const hasEnvTelemetry = Boolean(flagsValue & TEL_ENV_FLAG)
  const typeLabel =
    contact.type != null ? NODE_TYPE_LABEL[contact.type] ?? `Type ${contact.type}` : "Unknown"
  const typeBadge =
    contact.type != null ? NODE_TYPE_BADGE[contact.type] ?? `T${contact.type}` : "Unknown"
  const showPosition = hasGps(contact.adv_lat, contact.adv_lon)
  const distance = computeDistance(contact, selfInfo)
  const hops = parseRepeaterPath(pathString(contact) ?? null, allContacts ?? {})
  const isRepOrRoom = contact.type === 2 || contact.type === 3

  const lastHeard = formatLastSeen(contact.last_advert)

  const headerActions = (
    <>
      <MuteToggle
        kind="contact"
        // Bridge stores pubkey_prefix (6 bytes = 12 hex chars).
        // Slice the full pubkey to that same prefix so the mute key
        // matches whatever the bridge sees on inbound DMs.
        targetKey={pubKey.slice(0, 12)}
        name={displayName}
        size="icon"
      />
      <Button
        variant="ghost"
        size="icon"
        aria-label={isStarred ? "Unstar contact" : "Star contact"}
        aria-pressed={isStarred}
        onClick={() =>
          flags.mutate({ pubkey: pubKey, starred: !isStarred })
        }
      >
        <Star
          className={
            isStarred
              ? "h-5 w-5 fill-yellow-400 text-yellow-500"
              : "h-5 w-5 text-muted-foreground"
          }
        />
      </Button>
    </>
  )

  const backButton = (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => navigate(-1)}
      aria-label="Back"
    >
      <ArrowLeft className="h-5 w-5" />
    </Button>
  )

  return (
    <PageShell
      header={
        <PageHeader
          title={displayName}
          leftAction={backButton}
          actions={headerActions}
        />
      }
    >
      <div className="mx-auto max-w-3xl space-y-4">

        {/* Hero card */}
        <Card className="overflow-hidden">
          <CardHeader className="flex flex-row items-center gap-4 space-y-0">
            <ContactAvatar pubkey={pubKey} name={displayName} size="xl" />
            <div className="min-w-0 flex-1">
              <CardTitle className="truncate text-xl">{displayName}</CardTitle>
              <CardDescription className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                <Badge variant="secondary" className="text-[10px]">
                  {typeBadge}
                </Badge>
                {lastHeard && (
                  <span className="text-xs text-muted-foreground">
                    heard {lastHeard}
                  </span>
                )}
                {distance && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Navigation className="h-3 w-3" />
                    {distance}
                  </span>
                )}
              </CardDescription>
            </div>
          </CardHeader>
        </Card>

        {/* Quick actions
            When Message is hidden (REP/ROOM contacts) we have 3 tiles, not
            4 — `grid-cols-2` would leave Share alone on a second row. Switch
            to `grid-cols-3` in that case so all three fit on one row.
            min-h keeps icon+label centred when the label is a single word. */}
        <div
          className={
            isMessageableContact(contact.type)
              ? "grid grid-cols-2 gap-2 sm:grid-cols-4"
              : "grid grid-cols-3 gap-2"
          }
        >
          {isMessageableContact(contact.type) && (
            <ActionTile
              icon={MessageCircle}
              label="Message"
              onClick={() => navigate(`/chat/${pubKey}`)}
            />
          )}
          <ActionTile
            icon={Radio}
            label="Ping"
            loading={ping.isPending}
            onClick={() => ping.mutate({ pubkey: pubKey })}
          />
          <ActionTile
            icon={Thermometer}
            label="Telemetry"
            loading={tel.isPending}
            onClick={() =>
              tel.mutate(
                { pubkey: pubKey },
                {
                  onSuccess: (data) => {
                    setTelemetryData(data)
                    setTelemetryOpen(true)
                  },
                },
              )
            }
          />
          <ActionTile
            icon={Share2}
            label="Share"
            loading={share.isPending}
            onClick={() =>
              share.mutate(
                { pubkey: pubKey },
                {
                  onSuccess: (data) => {
                    setShareUri(data.uri)
                    setShareOpen(true)
                  },
                },
              )
            }
          />
        </div>

        {/* Identity */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Identity</CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-border/60 text-sm">
            <Row label="Name">
              <span className="font-medium">{displayName}</span>
              <CopyButton value={displayName} label="Name" />
            </Row>
            <Row label="Public key">
              <code className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
                {`${pubKey.slice(0, 16)}…${pubKey.slice(-8)}`}
              </code>
              <CopyButton value={pubKey} label="Public key" />
            </Row>
            <Row label="Type">{typeLabel}</Row>
            <Row label="Flags">
              {isStarred ? (
                <Badge
                  variant="secondary"
                  className="gap-1 text-[10px] text-yellow-700 dark:text-yellow-400"
                >
                  <Star className="h-3 w-3 fill-current" /> Starred
                </Badge>
              ) : null}
              {hasLocTelemetry ? (
                <Badge variant="secondary" className="text-[10px]">
                  Location telemetry
                </Badge>
              ) : null}
              {hasEnvTelemetry ? (
                <Badge variant="secondary" className="text-[10px]">
                  Env telemetry
                </Badge>
              ) : null}
              {!isStarred && !hasLocTelemetry && !hasEnvTelemetry && (
                <span className="text-xs text-muted-foreground">None</span>
              )}
            </Row>
          </CardContent>
        </Card>

        {/* Position */}
        {showPosition && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                Position
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 divide-y divide-border/60 text-sm">
              <Row label="Coordinates">
                <code className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
                  {contact.adv_lat!.toFixed(6)}, {contact.adv_lon!.toFixed(6)}
                </code>
                <CopyButton
                  value={`${contact.adv_lat!.toFixed(6)}, ${contact.adv_lon!.toFixed(6)}`}
                  label="Coordinates"
                />
              </Row>
              {distance && (
                <Row label="From you">
                  <Compass className="h-3.5 w-3.5 text-muted-foreground" />
                  {distance}
                </Row>
              )}
              {lastHeard && <Row label="Last advert">{lastHeard}</Row>}
              <div className="pt-3">
                <Button asChild variant="outline" size="sm" className="w-full sm:w-auto">
                  <Link to="/map">
                    <MapPin className="mr-1 h-4 w-4" /> Show on map
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Path */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <Route className="h-4 w-4 text-muted-foreground" />
              Path
            </CardTitle>
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => discoverPath.mutate({ pubkey: pubKey })}
                disabled={discoverPath.isPending}
              >
                {discoverPath.isPending && (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                )}
                Discover
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => resetPath.mutate({ pubkey: pubKey })}
                disabled={resetPath.isPending}
              >
                {resetPath.isPending && (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                )}
                Reset
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {hops.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Direct (no repeaters in path)
              </p>
            ) : (
              <ol className="space-y-1.5">
                {hops.map((h, i) => (
                  <li
                    key={`${h.hash}-${i}`}
                    className="flex items-center gap-3 rounded-md border border-border/40 bg-muted/30 px-3 py-2"
                  >
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-background text-[11px] font-semibold tabular-nums text-muted-foreground ring-1 ring-border">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div
                        className={`truncate text-sm ${
                          h.resolved ? "font-medium" : "text-muted-foreground italic"
                        }`}
                      >
                        {h.name}
                      </div>
                    </div>
                    <code className="rounded bg-background px-1.5 py-0.5 text-[10px] tracking-wider text-muted-foreground ring-1 ring-border">
                      {h.hash}
                    </code>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        {/* Permissions (REP/ROOM only) */}
        {isRepOrRoom && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <Shield className="h-4 w-4 text-muted-foreground" />
                Permissions
              </CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  acl.mutate(
                    { pubkey: pubKey },
                    { onSuccess: (data) => setAclData(data) },
                  )
                }
                disabled={acl.isPending}
              >
                {acl.isPending ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                    Requesting…
                  </>
                ) : (
                  "Request ACL"
                )}
              </Button>
            </CardHeader>
            <CardContent>
              {aclData ? (
                <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs">
                  {JSON.stringify(aclData, null, 2)}
                </pre>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Tap “Request ACL” to query the access control list from this
                  node.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Link diagnostic */}
        {pubKey && <LinkDiagnosticPanel pubkey={pubKey} />}

        {/* Continuous trace monitor */}
        {pubKey && <TraceMonitorPanel pubkey={pubKey} />}

        {/* Danger zone */}
        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle className="text-base text-destructive">Danger zone</CardTitle>
            <CardDescription>
              Removing a contact deletes it on the device. Chat history stored
              in this web app is preserved.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm">
                  <Trash2 className="mr-1 h-4 w-4" /> Remove contact
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove {displayName}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This removes the contact from your device. You can always
                    re-import it later from a shared URI.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() =>
                      removeContact.mutate(
                        { pubkey: pubKey },
                        { onSuccess: () => navigate("/contacts") },
                      )
                    }
                  >
                    Remove
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>

        <Separator className="my-2 opacity-0" />
      </div>

      {/* Share URI dialog */}
      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Share contact</DialogTitle>
            <DialogDescription>
              Send this URI to add {displayName} on another node.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <code className="block max-h-40 overflow-auto break-all rounded-md bg-muted p-3 text-xs">
              {shareUri}
            </code>
            <Button
              size="sm"
              onClick={async () => {
                await navigator.clipboard.writeText(shareUri)
                toast.success("URI copied")
              }}
            >
              <Copy className="mr-1 h-4 w-4" /> Copy URI
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Telemetry result dialog */}
      <Dialog open={telemetryOpen} onOpenChange={setTelemetryOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Telemetry response</DialogTitle>
            <DialogDescription>
              Raw telemetry payload received from {displayName}.
            </DialogDescription>
          </DialogHeader>
          <pre className="max-h-[60vh] overflow-auto rounded-md bg-muted p-3 text-xs">
            {JSON.stringify(telemetryData, null, 2)}
          </pre>
        </DialogContent>
      </Dialog>
    </PageShell>
  )
}
