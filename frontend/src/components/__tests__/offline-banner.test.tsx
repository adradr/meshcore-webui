import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { OfflineBanner } from "@/components/offline-banner"
import { WebSocketContext } from "@/realtime/WebSocketProvider"
import type { WSStatus } from "@/realtime/useWebSocket"

let onlineNow = true
vi.mock("@/realtime/useOnlineStatus", () => ({
  useOnlineStatus: () => onlineNow,
}))

// Mock the polled status hook directly. Each test sets `mockStatus` so we
// don't have to drive react-query's internal scheduler.
let mockStatus: { connected: boolean; host: string | null; port: number | null } | undefined
vi.mock("@/features/device/queries", () => ({
  useDeviceStatus: () => ({
    data: mockStatus,
    isLoading: mockStatus === undefined,
  }),
}))

function makeWrapper(wsStatus: WSStatus) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
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
    )
  }
}

describe("OfflineBanner", () => {
  beforeEach(() => {
    onlineNow = true
    mockStatus = undefined
  })

  it("renders nothing when everything is healthy", () => {
    mockStatus = { connected: true, host: "192.168.4.1", port: 5000 }
    render(<OfflineBanner />, { wrapper: makeWrapper("open") })
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("renders nothing before the first device-status response (cold start)", () => {
    mockStatus = undefined
    render(<OfflineBanner />, { wrapper: makeWrapper("open") })
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("says 'offline' when the browser has no network — even if everything else is also down", () => {
    onlineNow = false
    mockStatus = { connected: false, host: null, port: null }
    render(<OfflineBanner />, { wrapper: makeWrapper("closed") })
    expect(screen.getByRole("alert").textContent).toMatch(/offline/i)
  })

  it("says 'WebUI service' when the browser↔server WS is down", () => {
    mockStatus = { connected: true, host: "192.168.4.1", port: 5000 }
    render(<OfflineBanner />, { wrapper: makeWrapper("connecting") })
    expect(screen.getByRole("alert").textContent).toMatch(/WebUI service/i)
  })

  it("says 'Mesh radio' when only the radio link is down", () => {
    mockStatus = { connected: false, host: "192.168.4.1", port: 5000 }
    render(<OfflineBanner />, { wrapper: makeWrapper("open") })
    expect(screen.getByRole("alert").textContent).toMatch(/mesh radio/i)
  })

  it("re-renders when the polled device-status flips from connected to disconnected", () => {
    mockStatus = { connected: true, host: "192.168.4.1", port: 5000 }
    const { rerender } = render(<OfflineBanner />, { wrapper: makeWrapper("open") })
    expect(screen.queryByRole("alert")).toBeNull()
    mockStatus = { connected: false, host: "192.168.4.1", port: 5000 }
    rerender(<OfflineBanner />)
    expect(screen.getByRole("alert").textContent).toMatch(/mesh radio/i)
  })
})
