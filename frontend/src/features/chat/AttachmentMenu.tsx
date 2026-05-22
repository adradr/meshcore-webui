import { useState } from "react"
import { toast } from "sonner"
import {
  Contact as ContactIcon,
  MapPin,
  Plus,
  Send,
  Users,
} from "lucide-react"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { useShareContact } from "@/features/contacts/queries"
import { useSelfInfo } from "@/features/device/queries"
import { SharedContactPicker } from "./SharedContactPicker"
import { ShareLocationMapDialog } from "./ShareLocationMapDialog"
import { formatLocationSnippet } from "./locationSnippet"

interface Props {
  /** Called with the snippet text to insert into the composer. */
  onInsert: (snippet: string) => void
  /** Disables the trigger button (e.g. while a message send is in flight). */
  disabled?: boolean
}

type View = "menu" | "contact-picker"

/**
 * Plus-button attachment menu rendered as the left adornment of the
 * chat composer. Opens a bottom Sheet with four actions:
 *
 * 1. My contact info — share own meshcore:// URI
 * 2. My current position — browser geolocation → OSM link snippet
 * 3. Share a contact — picker → meshcore:// URI of selected contact
 * 4. Share location on map — modal map → OSM link snippet
 *
 * Each successful action closes the sheet and calls `onInsert` so the
 * parent (`MessageInput`) can append the snippet to the draft.
 */
export function AttachmentMenu({ onInsert, disabled }: Props) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<View>("menu")
  const [mapOpen, setMapOpen] = useState(false)
  const [pendingAction, setPendingAction] = useState<string | null>(null)

  const selfInfo = useSelfInfo()
  const share = useShareContact()

  const closeAll = () => {
    setOpen(false)
    setView("menu")
    setPendingAction(null)
  }

  const insertAndClose = (snippet: string) => {
    onInsert(snippet)
    closeAll()
  }

  const handleMyContactInfo = () => {
    const pubkey = selfInfo.data?.public_key
    if (!pubkey) {
      toast.error("My contact info unavailable — radio not connected yet.")
      return
    }
    setPendingAction("self")
    share.mutate(
      { pubkey },
      {
        onSuccess: (data) => insertAndClose(data.uri),
        onSettled: () => setPendingAction(null),
      },
    )
  }

  const handleMyPosition = () => {
    if (!("geolocation" in navigator)) {
      toast.error("Geolocation is not available in this browser.")
      return
    }
    setPendingAction("geo")
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPendingAction(null)
        insertAndClose(
          formatLocationSnippet(pos.coords.latitude, pos.coords.longitude),
        )
      },
      (err) => {
        setPendingAction(null)
        toast.error(`Could not get position: ${err.message ?? "denied"}`)
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    )
  }

  const handlePickContact = (pubkey: string) => {
    setPendingAction("contact")
    share.mutate(
      { pubkey },
      {
        onSuccess: (data) => insertAndClose(data.uri),
        onSettled: () => setPendingAction(null),
      },
    )
  }

  const handleMapConfirm = (lat: number, lon: number) => {
    insertAndClose(formatLocationSnippet(lat, lon))
  }

  const handleSheetOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) {
      setView("menu")
      setPendingAction(null)
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-9 w-9 shrink-0"
        aria-label="Attach"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <Plus className="h-4 w-4" />
      </Button>
      <Sheet open={open} onOpenChange={handleSheetOpenChange}>
        <SheetContent
          side="bottom"
          className="flex max-h-[85vh] flex-col gap-3 sm:mx-auto sm:max-w-md"
        >
          {view === "menu" ? (
            <>
              <SheetHeader>
                <SheetTitle>Attach</SheetTitle>
                <SheetDescription>
                  Insert shareable contact info or a location into your
                  message.
                </SheetDescription>
              </SheetHeader>
              <div className="flex flex-col gap-1 p-2">
                <MenuRow
                  icon={<ContactIcon className="h-4 w-4" />}
                  title="My contact info"
                  subtitle="Share your meshcore:// URI"
                  busy={pendingAction === "self"}
                  onClick={handleMyContactInfo}
                />
                <MenuRow
                  icon={<MapPin className="h-4 w-4" />}
                  title="My current position"
                  subtitle="Use this browser's GPS"
                  busy={pendingAction === "geo"}
                  onClick={handleMyPosition}
                />
                <MenuRow
                  icon={<Users className="h-4 w-4" />}
                  title="Share a contact"
                  subtitle="Pick someone from your contacts"
                  onClick={() => setView("contact-picker")}
                />
                <MenuRow
                  icon={<Send className="h-4 w-4" />}
                  title="Share location on map"
                  subtitle="Drop a pin on a map"
                  onClick={() => {
                    setOpen(false)
                    setMapOpen(true)
                  }}
                />
              </div>
            </>
          ) : (
            <>
              <SheetHeader>
                <SheetTitle>Share a contact</SheetTitle>
                <SheetDescription>
                  Pick a contact to insert their meshcore:// share URI
                  into your message.
                </SheetDescription>
              </SheetHeader>
              <div className="flex min-h-0 flex-1 flex-col px-4 pb-4">
                <SharedContactPicker
                  onPick={handlePickContact}
                  excludePubKey={selfInfo.data?.public_key}
                />
                <div className="pt-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setView("menu")}
                    disabled={pendingAction === "contact"}
                  >
                    Back
                  </Button>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
      <ShareLocationMapDialog
        open={mapOpen}
        onOpenChange={setMapOpen}
        initialLat={selfInfo.data?.adv_lat ?? null}
        initialLon={selfInfo.data?.adv_lon ?? null}
        onConfirm={handleMapConfirm}
      />
    </>
  )
}

interface MenuRowProps {
  icon: React.ReactNode
  title: string
  subtitle: string
  busy?: boolean
  onClick: () => void
}

/** Single tappable row inside the attachment Sheet. */
function MenuRow({ icon, title, subtitle, busy, onClick }: MenuRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="flex items-center gap-3 rounded-md px-3 py-3 text-left text-sm transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:opacity-60"
    >
      <span
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground"
        aria-hidden
      >
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium">{title}</span>
        <span className="truncate text-xs text-muted-foreground">
          {busy ? "Working…" : subtitle}
        </span>
      </span>
    </button>
  )
}
