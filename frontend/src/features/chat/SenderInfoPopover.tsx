import type { ReactNode } from "react"
import { Link } from "react-router-dom"
import { Copy, UserPlus } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { ContactAvatar } from "@/components/contact-avatar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

interface Props {
  name: string
  avatarSeed: string
  children: ReactNode
}

/**
 * Lightweight popover surfaced from an unresolved channel sender's avatar or
 * name label. Lets the user copy the sender name or jump to Contacts, where
 * they can add the sender once an advertisement reveals their public key.
 */
export function SenderInfoPopover({ name, avatarSeed, children }: Props) {
  const copyName = async () => {
    try {
      await navigator.clipboard.writeText(name)
      toast.success("Copied name")
    } catch {
      toast.error("Copy failed")
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent side="right" align="start" className="w-64 p-3">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <ContactAvatar pubkey={avatarSeed} name={name} size="default" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{name}</p>
              <p className="text-[10px] text-muted-foreground">
                Not in your contacts
              </p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            This sender hasn&apos;t been added to your contacts yet. You can
            copy their name to look them up, or wait for an advertisement to
            discover their public key.
          </p>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              onClick={copyName}
            >
              <Copy className="mr-1 h-3 w-3" /> Copy name
            </Button>
            <Button size="sm" variant="outline" className="flex-1" asChild>
              <Link to="/contacts">
                <UserPlus className="mr-1 h-3 w-3" /> Contacts
              </Link>
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
