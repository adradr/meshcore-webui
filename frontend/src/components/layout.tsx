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
    // Shell is pinned to the viewport with `position: fixed; inset: 0`, NOT a
    // height value. iOS standalone PWA reports an UNSTABLE viewport height —
    // `window.innerHeight` flips between ~793 and 852 on a Dynamic-Island
    // device, and `100vh` / `100dvh` / `height:100%` / a JS-measured height
    // each lock onto the wrong one, floating the bottom nav off the real edge.
    // A fixed box anchors to BOTH the top and bottom of the visual viewport,
    // so the nav lands at the true bottom regardless of what the height APIs
    // report (confirmed on-device: `position:fixed; bottom:0` hits the real
    // screen bottom even when innerHeight is wrong).
    <div
      className="safe-top fixed inset-0 flex flex-col"
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
