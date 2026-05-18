import { createBrowserRouter, RouterProvider } from "react-router-dom"
import { Layout } from "@/components/layout"
import { ChatPage } from "@/pages/chat"
import { ContactsPage } from "@/pages/contacts"
import { ChannelsPage } from "@/pages/channels"
import { MapPage } from "@/pages/map"
import { SettingsPage } from "@/pages/settings"
import { DevicePage } from "@/pages/device"

const router = createBrowserRouter([
  {
    path: "/",
    element: <Layout />,
    children: [
      { index: true, element: <ChatPage /> },
      { path: "chat/:pubKey?", element: <ChatPage /> },
      { path: "channel/:idx", element: <ChatPage /> },
      { path: "contacts", element: <ContactsPage /> },
      { path: "channels", element: <ChannelsPage /> },
      { path: "map", element: <MapPage /> },
      { path: "device", element: <DevicePage /> },
      { path: "settings", element: <SettingsPage /> },
    ],
  },
])

export function AppRouter() {
  return <RouterProvider router={router} />
}
