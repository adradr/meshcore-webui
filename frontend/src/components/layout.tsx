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
    <div className="flex h-[100dvh] flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-4">
        <h1 className="text-base font-semibold">MeshCore</h1>
        <ModeToggle />
      </header>
      <OfflineBanner />
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
      <nav className="grid h-16 shrink-0 grid-cols-8 border-t bg-background pb-[env(safe-area-inset-bottom)]">
        {NAV.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              `relative flex flex-col items-center justify-center gap-1 text-[10px] ${
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
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
      <Toaster position="top-center" />
    </div>
  )
}
