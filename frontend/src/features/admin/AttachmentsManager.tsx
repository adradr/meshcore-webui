import { Link } from "react-router-dom"
import { ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useAttachments } from "@/features/attachments/queries"

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

/**
 * Settings → Attachments summary card.
 *
 * Compact card that shows aggregate storage usage and links out to the
 * dedicated `/attachments` page. The full grid (with infinite scroll,
 * click-to-copy, per-item delete) lives at the route — keeping it off the
 * Settings page stops the attachments list query from firing every time
 * the user opens Settings.
 *
 * The aggregate counters still ride on `useAttachments()` (the same list
 * endpoint), but the totals are cheap server-side and the cache is shared
 * with the dedicated page so navigating there is instant.
 */
export function AttachmentsManager() {
  const list = useAttachments()
  const total = list.data?.total_count
  const bytes = list.data?.total_bytes

  return (
    <Card data-testid="attachments-manager">
      <CardHeader className="space-y-1">
        <CardTitle className="text-base">Attachments</CardTitle>
        <p className="text-xs text-muted-foreground">
          Image attachments shared from this device. Manage to view, copy
          links, or delete.
        </p>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        <p
          className="text-sm tabular-nums text-muted-foreground"
          data-testid="attachments-summary"
        >
          {list.isLoading
            ? "Loading…"
            : total == null
              ? "—"
              : total === 0
                ? "No attachments yet"
                : `${total} attachment${total === 1 ? "" : "s"} · ${formatBytes(bytes ?? 0)}`}
        </p>
        <Button asChild size="sm" variant="outline">
          <Link to="/attachments">
            Manage attachments
            <ArrowRight className="ml-1 h-3.5 w-3.5" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  )
}
