import { Outlet } from "react-router-dom"

export function Layout() {
  return (
    <div className="flex h-[100dvh] flex-col">
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  )
}
