import { useMemo, useState } from "react"
import { ShieldAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  useReset,
  useDeviceFactoryReset,
  type LocalResetSelector,
  type DeviceResetSelector,
} from "./api"

// All target keys and their human labels, in display order. Source of
// truth for both rendering and the "X target(s) selected" counter.
const LOCAL_TARGETS: {
  key: keyof LocalResetSelector
  label: string
  help: string
}[] = [
  {
    key: "messages",
    label: "Chat history",
    help: "All DMs and channel messages stored on this server.",
  },
  {
    key: "diagnostic_runs",
    label: "Diagnostic runs",
    help: "Saved Link Diagnostic reports.",
  },
  {
    key: "rx_log",
    label: "RX log",
    help: "Long-term RX log persistence (only meaningful when enabled).",
  },
  {
    key: "mutes",
    label: "Conversation mutes",
    help: "All per-contact / per-channel mute preferences.",
  },
  {
    key: "settings",
    label: "Settings",
    help: "Push mode and conversation read markers.",
  },
  {
    key: "push_subscribers",
    label: "Push subscribers",
    help: "Every enrolled browser must re-enable notifications.",
  },
  {
    key: "trace_samples",
    label: "Trace monitor history",
    help: "All persisted trace-monitor samples (per-contact periodic path traces).",
  },
]

const DEVICE_TARGETS: {
  key: keyof DeviceResetSelector
  label: string
  help: string
}[] = [
  {
    key: "channels",
    label: "Non-Public channels",
    help: "Clears every channel slot except idx 0 (Public).",
  },
  {
    key: "coords",
    label: "GPS coordinates",
    help: "Sets the device's lat/lon back to 0,0.",
  },
  {
    key: "contacts",
    label: "Contacts",
    help: "Removes every contact. NOTE: contacts re-populate from incoming adverts within seconds on an active mesh. Pair with Reboot device for an empty start.",
  },
  {
    key: "reboot",
    label: "Reboot device",
    help: "Soft-reboots the radio after any other selected operations. Flushes the RX queue — pair with Contacts to prevent in-flight adverts from immediately re-populating what you just deleted. Link drops for ~1-2s while the radio comes back.",
  },
]

const CONFIRM_TOKEN = "RESET"

/**
 * Typed-confirm dialog: user must type `expected` exactly. Optionally
 * (factory reset) also requires checking a separate checkbox before the
 * action enables. State resets on close so reopening starts clean.
 *
 * Kept dedicated to the factory-reset flow — identity wipe is qualitatively
 * different from the toggle-style "pick what to clear" reset and warrants
 * its own gating UX.
 */
function TypedConfirmDialog({
  trigger,
  title,
  description,
  expected,
  requireCheckbox,
  checkboxLabel,
  actionLabel,
  onConfirm,
  pending,
}: {
  trigger: React.ReactNode
  title: string
  description: string
  expected: string
  requireCheckbox?: boolean
  checkboxLabel?: string
  actionLabel: string
  onConfirm: () => void
  pending: boolean
}) {
  const [typed, setTyped] = useState("")
  const [checked, setChecked] = useState(false)
  const matches = typed === expected
  const ready = matches && (!requireCheckbox || checked)

  return (
    <AlertDialog
      onOpenChange={(open) => {
        if (!open) {
          setTyped("")
          setChecked(false)
        }
      }}
    >
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">
              Type <code className="rounded bg-muted px-1">{expected}</code> to
              confirm
            </Label>
            <Input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={expected}
              disabled={pending}
              aria-label={`Confirm by typing ${expected}`}
            />
          </div>
          {requireCheckbox && (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => setChecked(e.target.checked)}
                disabled={pending}
                className="mt-0.5"
              />
              <span>{checkboxLabel}</span>
            </label>
          )}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} disabled={!ready || pending}>
            {pending ? "Working…" : actionLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

interface UnifiedResetDialogProps {
  trigger: React.ReactNode
}

/**
 * Unified reset dialog — 10 checkboxes (7 local + 3 device) plus a typed
 * RESET confirmation. The action label reflects the selected count so users
 * can sanity-check the scope before clicking. Disabled until both at-least-
 * one-target AND typed-confirm gates are satisfied.
 *
 * On mutation success we close; on failure we keep the dialog open so the
 * user can retry without losing their selection.
 */
function UnifiedResetDialog({ trigger }: UnifiedResetDialogProps) {
  const reset = useReset()
  const [open, setOpen] = useState(false)
  const [local, setLocal] = useState<LocalResetSelector>({})
  const [device, setDevice] = useState<DeviceResetSelector>({})
  const [typed, setTyped] = useState("")

  const selectedCount = useMemo(() => {
    const l = LOCAL_TARGETS.reduce((n, t) => (local[t.key] ? n + 1 : n), 0)
    const d = DEVICE_TARGETS.reduce((n, t) => (device[t.key] ? n + 1 : n), 0)
    return l + d
  }, [local, device])

  const ready = selectedCount > 0 && typed === CONFIRM_TOKEN && !reset.isPending

  const onOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) {
      // Reset internal state on close so reopening shows a clean form.
      setLocal({})
      setDevice({})
      setTyped("")
    }
  }

  const onConfirm = (e: React.MouseEvent) => {
    // Prevent Radix's default Action behavior from closing the dialog
    // before we know whether the mutation succeeded. We close manually
    // in onSuccess; on error we stay open so the user can retry.
    e.preventDefault()
    reset.mutate(
      { local, device, confirm: typed },
      {
        onSuccess: () => setOpen(false),
      },
    )
  }

  const toggleLocal = (k: keyof LocalResetSelector) =>
    setLocal((cur) => ({ ...cur, [k]: !cur[k] }))
  const toggleDevice = (k: keyof DeviceResetSelector) =>
    setDevice((cur) => ({ ...cur, [k]: !cur[k] }))

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent className="max-h-[85vh] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle>Reset</AlertDialogTitle>
          <AlertDialogDescription>
            Pick what to clear. Local items live in this server's database;
            device items are persisted on the radio's flash. Nothing here
            touches the device's identity keypair — for that use Factory reset
            below.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-4">
          <section className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              This WebUI server (local DB)
            </h4>
            {LOCAL_TARGETS.map((t) => (
              <label key={t.key} className="flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={!!local[t.key]}
                  onChange={() => toggleLocal(t.key)}
                  disabled={reset.isPending}
                  className="mt-0.5"
                  data-testid={`reset-local-${t.key}`}
                  aria-label={`Reset ${t.label}`}
                />
                <span className="flex-1">
                  <span className="font-medium">{t.label}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t.help}
                  </span>
                </span>
              </label>
            ))}
          </section>

          <Separator />

          <section className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              This radio device (flash)
            </h4>
            {DEVICE_TARGETS.map((t) => (
              <label key={t.key} className="flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={!!device[t.key]}
                  onChange={() => toggleDevice(t.key)}
                  disabled={reset.isPending}
                  className="mt-0.5"
                  data-testid={`reset-device-${t.key}`}
                  aria-label={`Reset ${t.label}`}
                />
                <span className="flex-1">
                  <span className="font-medium">{t.label}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t.help}
                  </span>
                </span>
              </label>
            ))}
          </section>

          <Separator />

          <div className="space-y-1">
            <Label className="text-xs">
              Type <code className="rounded bg-muted px-1">{CONFIRM_TOKEN}</code>{" "}
              to confirm
            </Label>
            <Input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={CONFIRM_TOKEN}
              disabled={reset.isPending}
              aria-label="Confirm by typing RESET"
            />
            <p className="text-xs text-muted-foreground">
              {selectedCount} target{selectedCount === 1 ? "" : "s"} selected
            </p>
          </div>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={reset.isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} disabled={!ready}>
            {reset.isPending
              ? "Working…"
              : `Reset ${selectedCount} target${selectedCount === 1 ? "" : "s"}`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/**
 * Danger zone — a single unified Reset dialog (9 toggleable targets) plus a
 * dedicated Factory-reset row. Factory reset stays separate because it
 * wipes the Ed25519 identity, which is qualitatively different from the
 * "pick what to clear" reset flow.
 */
export function DangerZone() {
  const factoryReset = useDeviceFactoryReset()

  return (
    <Card className="border-destructive/40">
      <CardHeader className="flex flex-row items-center gap-2 space-y-0">
        <ShieldAlert className="h-4 w-4 text-destructive" />
        <CardTitle className="text-base">Danger zone</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">Reset</div>
              <div className="text-xs text-muted-foreground">
                Pick what to clear — local data, device flash, or both.
                Identity is preserved.
              </div>
            </div>
            <UnifiedResetDialog
              trigger={
                <Button variant="destructive" size="sm">
                  Reset…
                </Button>
              }
            />
          </div>
        </section>

        <Separator />

        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Factory reset (destroys identity)
          </h3>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">Factory reset device</div>
              <div className="text-xs text-muted-foreground">
                Wipes ALL device state including the Ed25519 identity. A new
                pubkey is generated; every peer sees this radio as a new node.
              </div>
            </div>
            <TypedConfirmDialog
              trigger={
                <Button variant="destructive" size="sm">
                  Factory reset…
                </Button>
              }
              title="Factory reset the device?"
              description="This is unrecoverable. The radio reboots with a new identity. Anyone who had this device starred / contacted will see a fresh stranger node."
              expected="FACTORY RESET"
              requireCheckbox
              checkboxLabel="I understand my pubkey will change."
              actionLabel="Factory reset"
              pending={factoryReset.isPending}
              onConfirm={() => factoryReset.mutate({ confirm: "FACTORY RESET" })}
            />
          </div>
        </section>
      </CardContent>
    </Card>
  )
}
