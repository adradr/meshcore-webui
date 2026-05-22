import { KeyRound, KeySquare, Globe2, Hash, QrCode } from "lucide-react"
import { Card } from "@/components/ui/card"

export type AddChannelMode =
  | "create-private"
  | "join-private"
  | "join-public"
  | "join-hashtag"
  | "scan-qr"

interface OptionMeta {
  mode: AddChannelMode
  title: string
  description: string
  icon: React.ComponentType<{ className?: string }>
}

const OPTIONS: OptionMeta[] = [
  {
    mode: "create-private",
    title: "Create a Private Channel",
    description: "Secured with a secret key — share the key to invite others.",
    icon: KeyRound,
  },
  {
    mode: "join-private",
    title: "Join a Private Channel",
    description: "Enter the channel name and 32-character secret.",
    icon: KeySquare,
  },
  {
    mode: "join-public",
    title: "Join the Public Channel",
    description: "Anyone can join. Uses slot #0 with the public PSK.",
    icon: Globe2,
  },
  {
    mode: "join-hashtag",
    title: "Join a Hashtag Channel",
    description: "Name starts with #. PSK is derived from the name.",
    icon: Hash,
  },
  {
    mode: "scan-qr",
    title: "Scan QR Code",
    description: "Read a meshcore://channel/add link from another device.",
    icon: QrCode,
  },
]

/**
 * Entry grid for the Add-Channel sheet. Renders five identically-shaped
 * cards; the parent owns which mode is active.
 */
export function AddChannelOptions({
  onSelect,
}: {
  onSelect: (mode: AddChannelMode) => void
}) {
  return (
    <div className="grid gap-2">
      {OPTIONS.map(({ mode, title, description, icon: Icon }) => (
        <Card
          key={mode}
          role="button"
          tabIndex={0}
          aria-label={title}
          onClick={() => onSelect(mode)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault()
              onSelect(mode)
            }
          }}
          className="cursor-pointer p-3 transition-colors hover:bg-accent/40"
        >
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent/60 text-foreground">
              <Icon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium">{title}</div>
              <div className="text-xs text-muted-foreground">{description}</div>
            </div>
          </div>
        </Card>
      ))}
    </div>
  )
}
