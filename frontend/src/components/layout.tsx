import { useEffect } from "react"
import { Outlet, NavLink } from "react-router-dom"
import { Toaster } from "@/components/ui/sonner"
import {
  BottomNav,
  BottomNavList,
  BottomNavItem,
  BottomNavIcon,
  BottomNavBadge,
  BottomNavLabel,
} from "@/components/ui/bottom-nav"
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
    // Shell fills the parent via `h-full` (html → body → #root are all
    // `h-full overflow-hidden` in index.css). Percentage heights avoid
    // viewport-unit bugs on iOS standalone PWA where `100vh` can overshoot
    // the visible area by the home-indicator height.
    <div
      className="safe-top flex h-full flex-col"
    >
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-4">
        <h1 className="text-base font-semibold tracking-wider">MESHCORE</h1>
        <ModeToggle />
      </header>
      <OfflineBanner />
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
      <BottomNav>
        <BottomNavList>
          {NAV.map(({ to, icon: Icon, label }) => (
            <BottomNavItem key={to} asChild>
              <NavLink to={to} end={to === "/"} title={label} aria-label={label}>
                <BottomNavIcon>
                  <Icon />
                  {to === "/" && total > 0 && (
                    <BottomNavBadge aria-label={`${total} unread messages`}>
                      {total > 99 ? "99+" : total}
                    </BottomNavBadge>
                  )}
                </BottomNavIcon>
                <BottomNavLabel>{label}</BottomNavLabel>
              </NavLink>
            </BottomNavItem>
          ))}
        </BottomNavList>
      </BottomNav>
      <Toaster position="top-center" />
    </div>
  )
}
