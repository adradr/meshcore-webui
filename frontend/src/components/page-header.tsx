import { cn } from "@/lib/utils"
import type { ReactNode } from "react"

interface PageHeaderProps {
  title: string
  /** Optional right-aligned action slot (buttons, badges). */
  actions?: ReactNode
  /**
   * Optional left-aligned slot, rendered before the title — typically a
   * Back button on detail pages. iOS-style nav bar pattern: leading icon,
   * then title, then trailing actions, all on a single row.
   */
  leftAction?: ReactNode
  /** Optional short helper text under the title. */
  subtitle?: string
  className?: string
}

/**
 * Sticky page title strip. Matches the visual treatment used by
 * `pages/channels.tsx` (the most polished list page). Anchored at the top
 * of every page so the user always knows where they are. Title is
 * `text-sm font-semibold` to match the existing app voice.
 */
export function PageHeader({
  title,
  actions,
  leftAction,
  subtitle,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        "flex shrink-0 items-center justify-between gap-2 border-b bg-background px-3 py-2",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-1">
        {leftAction && <div className="flex shrink-0 items-center">{leftAction}</div>}
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">{title}</h2>
          {subtitle && (
            <p className="truncate text-[11px] text-muted-foreground">
              {subtitle}
            </p>
          )}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </header>
  )
}
