import { useState } from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { usePurgeAttachments } from "@/features/attachments/queries"

const CONFIRM_TOKEN = "PURGE"

interface PurgeConfirmModalProps {
  /** Total attachment count, surfaced in the title for sanity-check. */
  totalCount: number
  /** Controlled-open state from the parent (the manager's "Purge" button). */
  open: boolean
  /** Parent owns the close action so it can hide the modal after success. */
  onClose: () => void
}

/**
 * Typed-confirm modal for purging EVERY attachment.
 *
 * Mirrors the typed-confirm dialog convention already used for "RESET" in
 * `DangerZone.tsx`. The action button is disabled until the user types the
 * exact token (`PURGE`). On a successful mutation we delegate close to the
 * parent so the manager can also clean up its own state.
 */
export function PurgeConfirmModal({
  totalCount,
  open,
  onClose,
}: PurgeConfirmModalProps) {
  const purge = usePurgeAttachments()
  const [typed, setTyped] = useState("")

  const matches = typed === CONFIRM_TOKEN
  const ready = matches && !purge.isPending

  const onOpenChange = (next: boolean) => {
    if (!next) {
      // Reset internal state on close so reopening shows a clean form.
      setTyped("")
      onClose()
    }
  }

  const onConfirm = (e: React.MouseEvent) => {
    // Prevent Radix's default Action behavior from closing the dialog
    // before we know the mutation result.
    e.preventDefault()
    purge.mutate(undefined, {
      onSuccess: () => {
        setTyped("")
        onClose()
      },
    })
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Delete all {totalCount} attachments
          </AlertDialogTitle>
          <AlertDialogDescription>
            Already-sent message links will break — they'll show "no longer
            available" when opened.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-1">
          <Label className="text-xs">
            Type <code className="rounded bg-muted px-1">{CONFIRM_TOKEN}</code>{" "}
            to confirm
          </Label>
          <Input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={CONFIRM_TOKEN}
            disabled={purge.isPending}
            aria-label="Confirm by typing PURGE"
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={purge.isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} disabled={!ready}>
            {purge.isPending ? "Working…" : "Delete all"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
