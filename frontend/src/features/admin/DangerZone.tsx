import { useState } from "react"
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
  useLocalReset,
  useDeviceSoftReset,
  useDeviceFactoryReset,
} from "./api"

/** A single row inside the danger zone: label/description on the left, action on the right. */
interface ResetRowProps {
  label: string
  description?: string
  children: React.ReactNode // the AlertDialog wrapping the trigger button
}
function ResetRow({ label, description, children }: ResetRowProps) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {description && (
          <div className="text-xs text-muted-foreground">{description}</div>
        )}
      </div>
      {children}
    </div>
  )
}

/** Simple confirm — no typed token, just a single click on the destructive action. */
function SimpleConfirmDialog({
  trigger,
  title,
  description,
  actionLabel,
  onConfirm,
  pending,
}: {
  trigger: React.ReactNode
  title: string
  description: string
  actionLabel: string
  onConfirm: () => void
  pending: boolean
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} disabled={pending}>
            {pending ? "Working…" : actionLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/**
 * Typed-confirm dialog: user must type `expected` exactly. Optionally
 * (factory reset) also requires checking a separate checkbox before the
 * action enables. State resets on close so reopening starts clean.
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
              Type{" "}
              <code className="rounded bg-muted px-1">{expected}</code> to
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
          <AlertDialogAction
            onClick={onConfirm}
            disabled={!ready || pending}
          >
            {pending ? "Working…" : actionLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/**
 * Danger zone — five destructive actions grouped by scope. Each one demands
 * an explicit confirmation that matches the backend's hmac.compare_digest
 * tokens, so a typo or wrong-case attempt gets rejected with 422 *before*
 * the radio receives anything.
 */
export function DangerZone() {
  const localReset = useLocalReset()
  const softReset = useDeviceSoftReset()
  const factoryReset = useDeviceFactoryReset()

  return (
    <Card className="border-destructive/40">
      <CardHeader className="flex flex-row items-center gap-2 space-y-0">
        <ShieldAlert className="h-4 w-4 text-destructive" />
        <CardTitle className="text-base">Danger zone</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Local data (this WebUI server)
          </h3>
          <ResetRow
            label="Clear chat history"
            description="Delete every message stored on this server. The radio's own state is untouched."
          >
            <SimpleConfirmDialog
              trigger={
                <Button variant="destructive" size="sm">
                  Clear…
                </Button>
              }
              title="Clear chat history?"
              description="This wipes every DM and channel message persisted on this server. Cannot be undone."
              actionLabel="Clear chat history"
              pending={localReset.isPending}
              onConfirm={() =>
                localReset.mutate({
                  scope: "messages",
                  confirm: "Clear chat history",
                })
              }
            />
          </ResetRow>
          <ResetRow
            label="Reset all local data"
            description="Wipe messages, diagnostics, RX log, mutes, settings. Push subscribers are preserved."
          >
            <TypedConfirmDialog
              trigger={
                <Button variant="destructive" size="sm">
                  Reset…
                </Button>
              }
              title="Reset all local data?"
              description="Every chat, diagnostic run, RX-log row, mute, and preference will be deleted. Push subscribers (browsers enrolled for notifications) are preserved."
              expected="RESET"
              actionLabel="Reset"
              pending={localReset.isPending}
              onConfirm={() =>
                localReset.mutate({ scope: "all", confirm: "RESET" })
              }
            />
          </ResetRow>
          <ResetRow
            label="Reset push subscribers"
            description="Every browser must re-enable notifications after this."
          >
            <SimpleConfirmDialog
              trigger={
                <Button variant="destructive" size="sm">
                  Reset…
                </Button>
              }
              title="Reset push subscribers?"
              description="Delete every Web Push subscription. Each enrolled browser needs to re-enable notifications to receive pushes again."
              actionLabel="Reset push subscribers"
              pending={localReset.isPending}
              onConfirm={() =>
                localReset.mutate({
                  scope: "push",
                  confirm: "Reset push subscribers",
                })
              }
            />
          </ResetRow>
        </section>
        <Separator />
        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Radio device
          </h3>
          <ResetRow
            label="Soft reset (channels + coords)"
            description="Clear non-public channels and GPS coordinates on the device. Identity, contacts and radio params are preserved."
          >
            <TypedConfirmDialog
              trigger={
                <Button variant="destructive" size="sm">
                  Reset device…
                </Button>
              }
              title="Soft-reset the device?"
              description="Clears every channel except Public and resets GPS to 0,0 on the device's flash. The device's identity, contacts, and radio params survive."
              expected="RESET"
              actionLabel="Soft reset"
              pending={softReset.isPending}
              onConfirm={() => softReset.mutate({ confirm: "RESET" })}
            />
          </ResetRow>
          <ResetRow
            label="Factory reset (incl. identity)"
            description="Wipes EVERYTHING — including the device's Ed25519 identity. A new pubkey is generated; every peer sees this radio as a new node."
          >
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
              onConfirm={() =>
                factoryReset.mutate({ confirm: "FACTORY RESET" })
              }
            />
          </ResetRow>
        </section>
      </CardContent>
    </Card>
  )
}
