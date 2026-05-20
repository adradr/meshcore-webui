import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, act } from "@testing-library/react"
import type { ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { OfflineBanner } from "@/components/offline-banner"
import { WebSocketContext } from "@/realtime/WebSocketProvider"
import type { WSStatus } from "@/realtime/useWebSocket"

let onlineNow = true
vi.mock("@/realtime/useOnlineStatus", () => ({
  useOnlineStatus: () => onlineNow,
}))

function makeWrapper(qc: QueryClient, wsStatus: WSStatus) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={qc}>
        <WebSocketContext.Provider
          value={{
            status: wsStatus,
            send: vi.fn(),
            lastMessage: null,
            subscribe: () => () => {},
          }}
        >
          {children}
        </WebSocketContext.Provider>
      </QueryClientProvider>
    )
  }
}

describe("OfflineBanner", () => {
  beforeEach(() => {
    onlineNow = true
  })

  it("renders nothing when everything is healthy", () => {
    const qc = new QueryClient()
    qc.setQueryData(["device", "status"], { connected: true })
    const Wrapper = makeWrapper(qc, "open")
    render(<OfflineBanner />, { wrapper: Wrapper })
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("renders nothing before the first device-status event (cold start)", () => {
    const qc = new QueryClient() // no setQueryData → undefined → assume connected
    const Wrapper = makeWrapper(qc, "open")
    render(<OfflineBanner />, { wrapper: Wrapper })
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("says 'offline' when the browser has no network — even if WS is also down", () => {
    onlineNow = false
    const qc = new QueryClient()
    qc.setQueryData(["device", "status"], { connected: false })
    const Wrapper = makeWrapper(qc, "closed")
    render(<OfflineBanner />, { wrapper: Wrapper })
    expect(screen.getByRole("alert").textContent).toMatch(/offline/i)
  })

  it("says 'WebUI service' when the browser↔server WS is down", () => {
    const qc = new QueryClient()
    qc.setQueryData(["device", "status"], { connected: true })
    const Wrapper = makeWrapper(qc, "connecting")
    render(<OfflineBanner />, { wrapper: Wrapper })
    expect(screen.getByRole("alert").textContent).toMatch(/WebUI service/i)
  })

  it("says 'Mesh radio' when only the radio link is down", () => {
    const qc = new QueryClient()
    qc.setQueryData(["device", "status"], { connected: false })
    const Wrapper = makeWrapper(qc, "open")
    render(<OfflineBanner />, { wrapper: Wrapper })
    expect(screen.getByRole("alert").textContent).toMatch(/mesh radio/i)
  })

  it("updates when the device status changes (push-only via WS)", () => {
    const qc = new QueryClient()
    qc.setQueryData(["device", "status"], { connected: true })
    const Wrapper = makeWrapper(qc, "open")
    render(<OfflineBanner />, { wrapper: Wrapper })
    expect(screen.queryByRole("alert")).toBeNull()
    act(() => {
      qc.setQueryData(["device", "status"], { connected: false })
    })
    expect(screen.getByRole("alert").textContent).toMatch(/mesh radio/i)
  })
})
