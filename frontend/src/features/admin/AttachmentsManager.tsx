import { useState } from "react"
import { Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  useAttachments,
  useDeleteAttachment,
} from "@/features/attachments/queries"
import { PurgeConfirmModal } from "./PurgeConfirmModal"

/** Human-readable size — same family as `du -h`, 1 KB = 1024 B. */
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

/**
 * Compact relative-time label from an ISO timestamp. Inline rather than
 * shared because the admin grid is the only consumer; the chat thread list
 * uses its own variant tuned for slightly different cadences.
 */
function relativeTime(iso: string): string {
  const d = new Date(iso).getTime()
  if (Number.isNaN(d)) return ""
  const diff = Date.now() - d
  if (diff < 0) return "now"
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} min ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d ago`
  return new Date(iso).toLocaleDateString()
}

/**
 * Settings → Attachments grid.
 *
 * Renders three states: loading, empty, populated. The header surfaces
 * total count + storage usage against the configured quota plus a single
 * destructive "Purge" entry point. Each card lazily loads its thumbnail and
 * exposes a trash button wired to `useDeleteAttachment` — the query hook
 * invalidates the list on success so the card disappears on the next
 * refetch.
 */
export function AttachmentsManager() {
  const list = useAttachments()
  const del = useDeleteAttachment()
  const [purgeOpen, setPurgeOpen] = useState(false)

  return (
    <Card>
      <CardHeader className="space-y-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base">Attachments</CardTitle>
            {list.data ? (
              <p className="text-xs text-muted-foreground">
                {list.data.total_count} file
                {list.data.total_count === 1 ? "" : "s"} ·{" "}
                {formatBytes(list.data.total_bytes)} of{" "}
                {formatBytes(list.data.quota_bytes)} (
                {list.data.quota_bytes > 0
                  ? Math.round(
                      (list.data.total_bytes / list.data.quota_bytes) * 100,
                    )
                  : 0}
                %)
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Images shared via short URLs are stored here.
              </p>
            )}
          </div>
          {list.data && list.data.total_count > 0 && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setPurgeOpen(true)}
            >
              Purge…
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {list.isLoading ? (
          <p
            className="text-sm text-muted-foreground"
            data-testid="attachments-loading"
          >
            Loading attachments…
          </p>
        ) : !list.data ? null : list.data.total_count === 0 ? (
          <p
            className="text-sm text-muted-foreground"
            data-testid="attachments-empty"
          >
            No attachments yet.
          </p>
        ) : (
          <div
            className="grid grid-cols-2 gap-3 md:grid-cols-4"
            data-testid="attachments-grid"
          >
            {list.data.items.map((item) => (
              <figure
                key={item.slug}
                className="flex flex-col gap-1 overflow-hidden rounded-md border bg-muted/30 p-2"
                data-testid={`attachment-card-${item.slug}`}
              >
                <div className="relative aspect-square w-full overflow-hidden rounded bg-muted">
                  <img
                    src={item.thumb_url}
                    alt={item.original_filename ?? item.slug}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                </div>
                <figcaption className="flex items-center justify-between gap-1 text-[11px] text-muted-foreground">
                  <span className="font-mono">{item.slug}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    aria-label={`Delete ${item.slug}`}
                    disabled={del.isPending}
                    onClick={() => del.mutate(item.slug)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </figcaption>
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>{formatBytes(item.size_bytes)}</span>
                  <span>{relativeTime(item.uploaded_at)}</span>
                </div>
              </figure>
            ))}
          </div>
        )}
      </CardContent>
      <PurgeConfirmModal
        totalCount={list.data?.total_count ?? 0}
        open={purgeOpen}
        onClose={() => setPurgeOpen(false)}
      />
    </Card>
  )
}
