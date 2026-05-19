import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { colorForPubkey, initialsFor } from "@/lib/avatar"
import { cn } from "@/lib/utils"

type AvatarSize = "sm" | "default" | "lg" | "xl"

interface Props {
  pubkey: string
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
 * Avatar with a deterministic background color derived from the contact's
 * pubkey and the contact's initials as the fallback glyph.
 *
 * Always renders the fallback (no image). The colored background gives
 * each contact a recognizable identity even before remembering the name.
 */
export function ContactAvatar({ pubkey, name, size = "default", className }: Props) {
  return (
    <Avatar className={cn(SIZE_CLASSES[size], className)}>
      <AvatarFallback
        className="font-semibold tracking-wide text-white"
        style={{ background: colorForPubkey(pubkey) }}
      >
        {initialsFor(name)}
      </AvatarFallback>
    </Avatar>
  )
}
