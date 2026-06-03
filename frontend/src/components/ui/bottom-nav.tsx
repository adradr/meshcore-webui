import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * Mobile bottom navigation bar (a.k.a. "tab bar" / "dock").
 *
 * Rendered as a flex-child `<nav>`, NOT `position: fixed`. iOS standalone PWA
 * has a known bug where `fixed bottom-0` + `safe-area-inset-bottom` renders
 * against the "large viewport" on launch, so the bar lands above its final
 * spot until a scroll forces a reflow. Flow layout sidesteps the bug.
 *
 * The split between the outer wrapper (variable safe-area padding via
 * `safe-bottom`) and the inner `BottomNavList` (fixed `h-16`) keeps the icon
 * row at a stable 4rem regardless of URL-bar transitions in Safari.
 */
function BottomNav({
  className,
  "aria-label": ariaLabel = "Primary",
  ...props
}: React.ComponentProps<"nav">) {
  return (
    <nav
      data-slot="bottom-nav"
      aria-label={ariaLabel}
      className={cn(
        "safe-bottom shrink-0 border-t bg-background",
        className
      )}
      {...props}
    />
  )
}

function BottomNavList({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="bottom-nav-list"
      // flex + flex-1 children distributes items evenly for any item count.
      className={cn("flex h-16", className)}
      {...props}
    />
  )
}

const bottomNavItemVariants = cva(
  cn(
    // Layout: equal-width column, icon over label.
    "group/bottom-nav-item relative flex flex-1 flex-col items-center justify-center gap-1",
    "text-[10px] font-medium outline-none transition-colors select-none",
    // Active state is driven by `aria-current="page"`, which react-router's
    // <NavLink> sets automatically — no render-prop wiring needed.
    "text-muted-foreground hover:text-foreground focus-visible:text-foreground",
    "aria-[current=page]:text-primary",
    // Icon sizing (unless an explicit size-* class is provided).
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5",
    // Active indicator: a small pill along the top edge that fades in.
    "after:pointer-events-none after:absolute after:inset-x-4 after:top-0 after:h-0.5 after:rounded-full after:bg-primary after:opacity-0 after:transition-opacity aria-[current=page]:after:opacity-100"
  )
)

function BottomNavItem({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<"a"> &
  VariantProps<typeof bottomNavItemVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "a"

  return (
    <Comp
      data-slot="bottom-nav-item"
      className={cn(bottomNavItemVariants(), className)}
      {...props}
    />
  )
}

/** Wrapper that anchors a {@link BottomNavBadge} relative to the icon. */
function BottomNavIcon({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="bottom-nav-icon"
      className={cn("relative", className)}
      {...props}
    />
  )
}

/**
 * iOS-native badge styling: solid red + white text + a ring matching the nav
 * background for separation. We avoid `bg-destructive/text-destructive-
 * foreground` here because the theme never defines `--destructive-foreground`,
 * which rendered dark-on-dark (invisible).
 */
function BottomNavBadge({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="bottom-nav-badge"
      className={cn(
        "absolute -top-1.5 -right-2 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] leading-none font-semibold tabular-nums text-white ring-2 ring-background",
        className
      )}
      {...props}
    />
  )
}

function BottomNavLabel({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="bottom-nav-label"
      // Hidden below sm so all icons fit comfortably on 360-390px PWAs.
      className={cn("hidden sm:inline", className)}
      {...props}
    />
  )
}

export {
  BottomNav,
  BottomNavList,
  BottomNavItem,
  BottomNavIcon,
  BottomNavBadge,
  BottomNavLabel,
  bottomNavItemVariants,
}
