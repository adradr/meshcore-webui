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
  Radio,
  Activity,
  Settings as SettingsIcon,
} from "lucide-react"

const NAV = [
  { to: "/", icon: MessageCircle, label: "Chat" },
  { to: "/contacts", icon: Users, label: "Contacts" },
  { to: "/channels", icon: Hash, label: "Channels" },
  { to: "/map", icon: Map, label: "Map" },
  { to: "/device", icon: Cpu, label: "Device" },
  { to: "/rx-log", icon: Radio, label: "RX Log" },
  { to: "/noise", icon: Activity, label: "Noise" },
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
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "calc(4rem + env(safe-area-inset-bottom))",
      }}
    >
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-4">
        <h1 className="text-base font-semibold">MeshCore</h1>
        <ModeToggle />
      </header>
      <OfflineBanner />
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
      <nav
        className="fixed inset-x-0 bottom-0 z-40 grid h-16 grid-cols-8 border-t bg-background pb-[env(safe-area-inset-bottom)]"
        aria-label="Primary"
      >
        {NAV.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            title={label}
            aria-label={label}
            className={({ isActive }) =>
              // Below sm: hide the text label so 8 icons fit comfortably on
              // 360-390px PWAs (was getting cramped + truncated). Icon + title
              // attr keeps discoverability; aria-label keeps it accessible.
              `relative flex flex-col items-center justify-center gap-0.5 sm:gap-1 text-[10px] ${
                isActive ? "text-primary" : "text-muted-foreground"
              }`
            }
          >
            <span className="relative">
              <Icon className="h-5 w-5" />
              {to === "/" && total > 0 && (
                <span
                  className="absolute -right-2 -top-1.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-semibold leading-none tabular-nums text-destructive-foreground"
                  aria-label={`${total} unread messages`}
                >
                  {total > 99 ? "99+" : total}
                </span>
              )}
            </span>
            <span className="hidden sm:inline">{label}</span>
          </NavLink>
        ))}
      </nav>
      <Toaster position="top-center" />
    </div>
  )
}
