import { useEffect } from "react"
import { Outlet, NavLink } from "react-router-dom"
import { Toaster } from "@/components/ui/sonner"
import { OfflineBanner } from "@/components/offline-banner"
import { ModeToggle } from "@/components/mode-toggle"
import { useUnreadTotal } from "@/features/chat/queries"
import {
  MessageCircle,
  Users,
  Hash,
  Map,
  Cpu,
  Settings as SettingsIcon,
} from "lucide-react"

const NAV = [
  { to: "/", icon: MessageCircle, label: "Chat" },
  { to: "/contacts", icon: Users, label: "Contacts" },
  { to: "/channels", icon: Hash, label: "Channels" },
  { to: "/map", icon: Map, label: "Map" },
  { to: "/device", icon: Cpu, label: "Device" },
  { to: "/settings", icon: SettingsIcon, label: "Settings" },
]

const BASE_TITLE = "MeshCore"

function useDocumentTitleUnreadBadge(unread: number) {
  useEffect(() => {
    document.title = unread > 0 ? `${BASE_TITLE} (${unread > 99 ? "99+" : unread})` : BASE_TITLE
    return () => {
      document.title = BASE_TITLE
    }
  }, [unread])
}

export function Layout() {
  const unread = useUnreadTotal()
  const total = unread.data?.total ?? 0
  useDocumentTitleUnreadBadge(total)

  return (
    // The nav is `fixed` so iOS Safari's URL-bar collapse animation doesn't
    // shift it mid-scroll (the layout used to use a flex child for the nav,
    // which produced a visible jump as `100dvh` recalculated). Reserve space
    // for the nav via padding on the shell so page content can't render under
    // it. The padding wraps the safe-area inset so home-bar devices still get
    // the bottom gutter automatically.
    // Shell pads for BOTH safe areas:
    //   top    → Dynamic Island / notch (otherwise header sits under it on standalone PWA)
    //   bottom → fixed nav (4rem) + home-indicator inset
    <div
      className="flex h-[100dvh] flex-col"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-4">
        <h1 className="text-base font-semibold tracking-wider">MESHCORE</h1>
        <ModeToggle />
      </header>
      <OfflineBanner />
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
      {/*
        Flex-child nav, NOT `position: fixed`. iOS standalone PWA has a known
        bug where `fixed bottom-0` + `safe-area-inset-bottom` renders against
        the "large viewport" on launch — so the nav lands above its final
        spot until a scroll forces a reflow. Flow layout sidesteps the bug.
        The split between outer wrapper (variable safe-area pb) and inner
        h-16 grid keeps the icon row at a stable 4rem regardless of URL-bar
        transitions in Safari.
      */}
      <nav
        className="shrink-0 border-t bg-background pb-[env(safe-area-inset-bottom)]"
        aria-label="Primary"
      >
        <div className="grid h-16 grid-cols-6">
          {NAV.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              title={label}
              aria-label={label}
              className={({ isActive }) =>
                // Below sm: hide the text label so all icons fit comfortably
                // on 360-390px PWAs. Icon + title attr keeps discoverability;
                // aria-label keeps it accessible.
                `relative flex flex-col items-center justify-center gap-1 text-[10px] ${
                  isActive ? "text-primary" : "text-muted-foreground"
                }`
              }
            >
              <span className="relative">
                <Icon className="h-5 w-5" />
                {to === "/" && total > 0 && (
                  <span
                    // iOS-native badge styling: solid red-500 + white text +
                    // ring matching the nav bg for separation. Previously used
                    // `bg-destructive text-destructive-foreground` but our
                    // theme never defines `--destructive-foreground`, so the
                    // text rendered as dark-gray-on-dark-red = invisible.
                    className="absolute -right-2 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none tabular-nums text-white ring-2 ring-background"
                    aria-label={`${total} unread messages`}
                  >
                    {total > 99 ? "99+" : total}
                  </span>
                )}
              </span>
              <span className="hidden sm:inline">{label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
      <Toaster position="top-center" />
    </div>
  )
}
