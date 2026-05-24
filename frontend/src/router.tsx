import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom"
import { Layout } from "@/components/layout"
import { ChatPage } from "@/pages/chat"
import { ContactsPage } from "@/pages/contacts"
import { ContactDetailPage } from "@/pages/contact-detail"
import { ChannelsPage } from "@/pages/channels"
import { MapPage } from "@/pages/map"
import { SettingsPage } from "@/pages/settings"
import { DevicePage } from "@/pages/device"
import { AttachmentsPage } from "@/pages/attachments"

const router = createBrowserRouter([
  {
    path: "/",
    element: <Layout />,
    children: [
      { index: true, element: <ChatPage /> },
      { path: "chat/:pubKey?", element: <ChatPage /> },
      { path: "channel/:idx", element: <ChatPage /> },
      { path: "contacts", element: <ContactsPage /> },
      { path: "contact/:pubKey", element: <ContactDetailPage /> },
      { path: "channels", element: <ChannelsPage /> },
      { path: "map", element: <MapPage /> },
      { path: "device", element: <DevicePage /> },
      // Legacy routes — RX Log and Noise are now tabs on /device.
      // Redirect old deep links so external bookmarks keep working.
      { path: "rx-log", element: <Navigate to="/device?tab=rx-log" replace /> },
      { path: "noise", element: <Navigate to="/device?tab=noise" replace /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "attachments", element: <AttachmentsPage /> },
    ],
  },
])

export function AppRouter() {
  return <RouterProvider router={router} />
}
