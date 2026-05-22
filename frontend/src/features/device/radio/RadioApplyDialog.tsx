/**
 * RadioApplyDialog — typed-APPLY AlertDialog confirm gate for radio config changes.
 *
 * The user must type the literal word "APPLY" before the action button enables,
 * preventing accidental radio reconfigurations.
 */
import { useRef, useState } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
import type { RadioConfig } from "../types"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CONFIRM_TOKEN = "APPLY"

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface RadioApplyDialogProps {
  presetLabel: string
  form: RadioConfig
  pending: boolean
  onConfirm: (form: RadioConfig) => void
  children: React.ReactNode
}

export function RadioApplyDialog({
  presetLabel,
  form,
  pending,
  onConfirm,
  children,
}: RadioApplyDialogProps) {
  const [typed, setTyped] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const ready = typed === CONFIRM_TOKEN

  return (
    <AlertDialog
      onOpenChange={(open) => {
        if (!open) setTyped("")
        // Auto-focus the input when the dialog opens
        if (open) {
          setTimeout(() => inputRef.current?.focus(), 50)
        }
      }}
    >
      <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Change radio configuration?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <span>
              Switching to{" "}
              <strong>{presetLabel}</strong> detunes this radio from any node
              still on the previous preset. The companion link will briefly drop
              while the modem re-initialises (~5 seconds).
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-1">
          <Label className="text-xs">
            Type{" "}
            <code className="rounded bg-muted px-1">{CONFIRM_TOKEN}</code> to
            confirm
          </Label>
          <Input
            ref={inputRef}
            data-testid="radio-apply-confirm-input"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={CONFIRM_TOKEN}
            disabled={pending}
            aria-label={`Confirm by typing ${CONFIRM_TOKEN}`}
            autoComplete="off"
          />
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            data-testid="radio-apply-confirm-btn"
            disabled={!ready || pending}
            onClick={(e) => {
              e.preventDefault()
              onConfirm(form)
            }}
          >
            {pending ? "Re-tuning…" : "Apply"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
