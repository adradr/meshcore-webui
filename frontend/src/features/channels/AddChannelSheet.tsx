import { useState } from "react"
import { ArrowLeft, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { AddChannelOptions, type AddChannelMode } from "./AddChannelOptions"
import { CreatePrivateForm } from "./CreatePrivateForm"
import { JoinPrivateForm } from "./JoinPrivateForm"
import { JoinPublicConfirm } from "./JoinPublicConfirm"
import { JoinHashtagForm } from "./JoinHashtagForm"
import { ScanQrFlow } from "./ScanQrFlow"

const TITLES: Record<AddChannelMode, { title: string; description: string }> =
  {
    "create-private": {
      title: "Create a Private Channel",
      description: "Pick a name; the secret stays on your radio.",
    },
    "join-private": {
      title: "Join a Private Channel",
      description: "Enter the channel name and shared secret.",
    },
    "join-public": {
      title: "Join the Public Channel",
      description: "Slot #0 with the firmware-derived public PSK.",
    },
    "join-hashtag": {
      title: "Join a Hashtag Channel",
      description: "The PSK is derived from the hashtag name.",
    },
    "scan-qr": {
      title: "Scan QR Code",
      description: "Decode a meshcore://channel/add link.",
    },
  }

/**
 * Bottom-sheet host for the five Add-Channel flows. Owns:
 *  - sheet open state
 *  - the currently active sub-flow (or `null` for the option grid)
 *  - reset-on-close so reopening lands on the grid
 *
 * Each sub-form calls `onSuccess` to close + reset the sheet after a
 * successful channel write.
 */
export function AddChannelSheet() {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<AddChannelMode | null>(null)

  const close = () => {
    setOpen(false)
  }
  // Reset to the option grid when the sheet is dismissed so the next open
  // starts from a clean slate (also clears any stale form state).
  const onOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) setMode(null)
  }

  const header = mode
    ? TITLES[mode]
    : {
        title: "Add a channel",
        description: "Pick how you want to add this channel.",
      }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1 h-4 w-4" /> Add channel
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto">
        <SheetHeader className="flex flex-row items-center gap-2">
          {mode && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setMode(null)}
              aria-label="Back to options"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
          <div className="min-w-0">
            <SheetTitle>{header.title}</SheetTitle>
            <SheetDescription>{header.description}</SheetDescription>
          </div>
        </SheetHeader>
        {mode === null && (
          <div className="px-4 pb-4">
            <AddChannelOptions onSelect={setMode} />
          </div>
        )}
        {mode === "create-private" && (
          <CreatePrivateForm onSuccess={close} />
        )}
        {mode === "join-private" && <JoinPrivateForm onSuccess={close} />}
        {mode === "join-public" && <JoinPublicConfirm onSuccess={close} />}
        {mode === "join-hashtag" && <JoinHashtagForm onSuccess={close} />}
        {mode === "scan-qr" && <ScanQrFlow onSuccess={close} />}
      </SheetContent>
    </Sheet>
  )
}
