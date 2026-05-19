import { cn } from "@/lib/utils"
import type { ReactNode, Ref } from "react"

interface PageShellProps {
  /** Sticky page title strip. Pass null for pages with no header (map). */
  header?: ReactNode
  /** Children render inside a scroll container. */
  children: ReactNode
  /** Padding around content. Default `p-4`; pass `p-0` for full-bleed (map). */
  contentClassName?: string
  /**
   * Optional ref to the scroll container. Needed by pages that virtualise
   * a list and have to attach scroll listeners to the actual overflow
   * element (e.g. contacts via @tanstack/react-virtual).
   */
  scrollRef?: Ref<HTMLDivElement>
}

/**
 * Common page chrome shared by every top-level route.
 *
 * Layout: flex column whose first row is the (optional) sticky title strip
 * and second row is a scrollable content area. Pages should NOT roll their
 * own `flex h-full flex-col` + scroll wrapper.
 *
 * Spacing scale used across the app (canonical — mimic these on new pages):
 *   - Page outer padding: `p-4`
 *   - Card stack gap: `space-y-3`
 *   - Card header: `p-3 pb-2`
 *   - Card body: `p-3 pt-2`
 *   - Page header strip: `h-12 px-3 py-2 border-b` (provided by PageHeader)
 *   - Cards use shadcn `<Card>` + `<CardHeader className="p-3 pb-2">` +
 *     `<CardContent className="p-3 pt-2">` (overrides default padding to
 *     match the tighter mobile-first feel of the rest of the app).
 */
export function PageShell({
  header,
  children,
  contentClassName,
  scrollRef,
}: PageShellProps) {
  return (
    <div className="flex h-full flex-col">
      {header}
      <div
        ref={scrollRef}
        className={cn("flex-1 overflow-y-auto", contentClassName ?? "p-4")}
      >
        {children}
      </div>
    </div>
  )
}
