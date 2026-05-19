import { ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"

interface Props {
  count: number
  onClick: () => void
}

/**
 * Floating pill at the bottom of the scroll container that appears when
 * the user has scrolled up and new messages have arrived (or just to
 * offer a quick jump back to the latest).
 */
export function NewMessagesPill({ count, onClick }: Props) {
  return (
    <Button
      onClick={onClick}
      size="sm"
      variant="secondary"
      className="absolute bottom-3 left-1/2 -translate-x-1/2 shadow-md animate-in fade-in slide-in-from-bottom-2"
    >
      <ChevronDown className="mr-1 h-3 w-3" />
      {count > 0 ? `${count} new message${count > 1 ? "s" : ""}` : "Jump to latest"}
    </Button>
  )
}
