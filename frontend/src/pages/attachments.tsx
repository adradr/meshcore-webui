import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowLeft, Check, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { PageShell } from "@/components/page-shell"
import { PageHeader } from "@/components/page-header"
import {
  useAttachments,
  useDeleteAttachment,
} from "@/features/attachments/queries"
import type { AttachmentOut } from "@/features/attachments/types"
import { PurgeConfirmModal } from "@/features/admin/PurgeConfirmModal"
import { useHaptic } from "@/haptics/HapticProvider"

const PAGE_SIZE = 24

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

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
 * Build the absolute public URL we want the user to copy. The API returns
 * `url` either as an absolute URL or a site-root relative path; in the
 * relative case prepend the current origin so the copied link is shareable.
 */
function publicUrl(item: AttachmentOut): string {
  if (/^https?:\/\//i.test(item.url)) return item.url
  if (typeof window === "undefined") return item.url
  return new URL(item.url, window.location.origin).toString()
}

interface TileProps {
  item: AttachmentOut
  onCopy: (item: AttachmentOut) => void
  onDelete: (slug: string) => void
  copied: boolean
  deleting: boolean
}

function AttachmentTile({ item, onCopy, onDelete, copied, deleting }: TileProps) {
  const label = item.original_filename ?? item.slug
  return (
    <figure
      className="flex flex-col gap-1 overflow-hidden rounded-md border bg-muted/30 p-2"
      data-testid={`attachment-card-${item.slug}`}
    >
      <button
        type="button"
        onClick={() => onCopy(item)}
        className="group relative block aspect-square w-full overflow-hidden rounded bg-muted focus:outline-none focus:ring-2 focus:ring-ring"
        aria-label={`Copy URL for ${label}`}
      >
        <img
          src={item.thumb_url}
          alt={label}
          loading="lazy"
          className="h-full w-full object-cover transition-opacity group-hover:opacity-90"
        />
        {copied && (
          <span
            className="absolute inset-0 grid place-items-center bg-background/70 text-foreground"
            data-testid={`attachment-copied-${item.slug}`}
            aria-hidden
          >
            <Check className="h-8 w-8" />
          </span>
        )}
      </button>
      <figcaption className="flex items-center justify-between gap-1 text-[11px] text-muted-foreground">
        <span className="truncate" title={label}>
          {label}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
          aria-label={`Delete ${item.slug}`}
          disabled={deleting}
          onClick={() => onDelete(item.slug)}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </figcaption>
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{formatBytes(item.size_bytes)}</span>
        <span>{relativeTime(item.uploaded_at)}</span>
      </div>
    </figure>
  )
}

export function AttachmentsPage() {
  const navigate = useNavigate()
  const haptic = useHaptic()
  const list = useAttachments()
  const del = useDeleteAttachment()
  const [visible, setVisible] = useState(PAGE_SIZE)
  const [purgeOpen, setPurgeOpen] = useState(false)
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null)
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  const items = list.data?.items ?? []
  const sliced = useMemo(() => items.slice(0, visible), [items, visible])
  const hasMore = items.length > visible

  // Reset visible count if the list shrinks below it (e.g. after delete/purge).
  useEffect(() => {
    if (visible > items.length && items.length > 0) {
      setVisible(Math.max(PAGE_SIZE, Math.min(items.length, visible)))
    }
  }, [items.length, visible])

  // IntersectionObserver-driven infinite scroll. Extends the visible window
  // by PAGE_SIZE each time the sentinel enters the viewport; falls back to
  // a no-op when IntersectionObserver isn't available (jsdom).
  useEffect(() => {
    if (!hasMore) return
    const node = sentinelRef.current
    if (!node || typeof IntersectionObserver === "undefined") return
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible((v) => v + PAGE_SIZE)
        }
      },
      { rootMargin: "200px" },
    )
    obs.observe(node)
    return () => obs.disconnect()
  }, [hasMore, sliced.length])

  const copy = async (item: AttachmentOut) => {
    const url = publicUrl(item)
    try {
      await navigator.clipboard.writeText(url)
      // Light tap pairs with the inline ✓ overlay swap — `toast.success`
      // stays bare (no `success` chord) so a power-user copy spree doesn't
      // turn into a buzz cascade.
      haptic.tap()
      toast.success("URL copied")
      setCopiedSlug(item.slug)
      window.setTimeout(() => {
        setCopiedSlug((s) => (s === item.slug ? null : s))
      }, 1000)
    } catch {
      toast.error("Copy failed")
    }
  }

  const backButton = (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => navigate(-1)}
      aria-label="Back"
    >
      <ArrowLeft className="h-5 w-5" />
    </Button>
  )

  const summary = list.data
    ? `${list.data.total_count} file${list.data.total_count === 1 ? "" : "s"} · ${formatBytes(list.data.total_bytes)} of ${formatBytes(list.data.quota_bytes)}`
    : undefined

  const actions =
    list.data && list.data.total_count > 0 ? (
      <Button
        variant="destructive"
        size="sm"
        onClick={() => setPurgeOpen(true)}
      >
        Purge…
      </Button>
    ) : undefined

  return (
    <PageShell
      header={
        <PageHeader
          title="Attachments"
          subtitle={summary}
          leftAction={backButton}
          actions={actions}
        />
      }
    >
      <div className="mx-auto max-w-5xl">
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
            No attachments yet. Images shared via short URLs from this device
            will appear here.
          </p>
        ) : (
          <>
            <div
              className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6"
              data-testid="attachments-grid"
            >
              {sliced.map((item) => (
                <AttachmentTile
                  key={item.slug}
                  item={item}
                  onCopy={copy}
                  onDelete={(slug) => del.mutate(slug)}
                  copied={copiedSlug === item.slug}
                  deleting={del.isPending}
                />
              ))}
            </div>
            {hasMore && (
              <div
                ref={sentinelRef}
                data-testid="attachments-sentinel"
                className="h-12 w-full"
                aria-hidden
              />
            )}
          </>
        )}
      </div>
      <PurgeConfirmModal
        totalCount={list.data?.total_count ?? 0}
        open={purgeOpen}
        onClose={() => setPurgeOpen(false)}
      />
    </PageShell>
  )
}
