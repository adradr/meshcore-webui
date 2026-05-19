import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { colorForPubkey } from "@/lib/avatar"
import { identiconBgColor, identiconDataUrl } from "@/lib/identicon"
import { cn } from "@/lib/utils"

type AvatarSize = "sm" | "default" | "lg" | "xl"

interface Props {
  idx: number
  name: string
  size?: AvatarSize
  className?: string
}

const SIZE_CLASSES: Record<AvatarSize, string> = {
  sm: "h-8 w-8 text-xs",
  default: "h-10 w-10 text-sm",
  lg: "h-12 w-12 text-base",
  xl: "h-16 w-16 text-xl",
}

/**
 * Avatar for a MeshCore channel. Uses a GitHub-style block identicon
 * seeded by both the channel index and name so different channels with
 * the same idx (e.g. across firmwares) still produce visually distinct
 * tiles, and renaming a channel produces a fresh look.
 *
 * Falls back to "#<idx>" text if the embedded identicon SVG ever fails
 * to render.
 */
export function ChannelAvatar({ idx, name, size = "default", className }: Props) {
  const seed = `chan:${idx}:${name}`
  const dataUrl = identiconDataUrl(seed)
  return (
    <Avatar
      className={cn(SIZE_CLASSES[size], "ring-1 ring-foreground/10", className)}
      style={{ background: identiconBgColor(seed) }}
    >
      <AvatarImage src={dataUrl} alt={`Channel ${name}`} />
      <AvatarFallback
        className="font-semibold tracking-wide text-white"
        style={{ background: colorForPubkey(seed) }}
      >
        #{idx}
      </AvatarFallback>
    </Avatar>
  )
}
