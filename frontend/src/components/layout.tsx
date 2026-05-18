import { Outlet, NavLink } from "react-router-dom"
import { Toaster } from "@/components/ui/sonner"
import { OfflineBanner } from "@/components/offline-banner"
import { ModeToggle } from "@/components/mode-toggle"
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

export function Layout() {
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
      <nav className="grid h-16 shrink-0 grid-cols-6 border-t bg-background pb-[env(safe-area-inset-bottom)]">
        {NAV.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              `flex flex-col items-center justify-center gap-1 text-[10px] ${
                isActive ? "text-primary" : "text-muted-foreground"
              }`
            }
          >
            <Icon className="h-5 w-5" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
      <Toaster position="top-center" />
    </div>
  )
}
