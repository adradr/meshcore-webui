import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import "@fontsource-variable/geist"
import "@fontsource-variable/geist-mono"
import "leaflet/dist/leaflet.css"
import "react-leaflet-cluster/dist/assets/MarkerCluster.css"
import "react-leaflet-cluster/dist/assets/MarkerCluster.Default.css"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ThemeProvider } from "@/components/theme-provider"
import { DevtoolsGate } from "@/DevtoolsGate"
import { AuthGate } from "@/features/auth/AuthGate"
import { AppRouter } from "@/router"
import {
  WebSocketProvider,
  resolveWsUrl,
} from "@/realtime/WebSocketProvider"
import { ReloadPrompt } from "@/pwa/ReloadPrompt"
import { HapticProvider } from "@/haptics/HapticProvider"
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: (failureCount, error: unknown) => {
        const status =
          typeof error === "object" && error && "status" in error
            ? (error as { status?: number }).status
            : undefined
        if (status && status >= 400 && status < 500) return false
        return failureCount < 3
      },
      refetchOnWindowFocus: false,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthGate>
        <WebSocketProvider url={resolveWsUrl()}>
          <ThemeProvider defaultTheme="system" storageKey="meshcore-ui-theme">
            <HapticProvider>
              <AppRouter />
              <ReloadPrompt />
            </HapticProvider>
          </ThemeProvider>
        </WebSocketProvider>
      </AuthGate>
      <DevtoolsGate />
    </QueryClientProvider>
  </StrictMode>,
)
