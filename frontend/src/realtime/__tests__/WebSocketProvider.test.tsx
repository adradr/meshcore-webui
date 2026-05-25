import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { act, render, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Server, WebSocket as MockClientWebSocket } from "mock-socket"
import type { ReactNode } from "react"
import { WebSocketProvider } from "../WebSocketProvider"
import { HapticProvider } from "@/haptics/HapticProvider"
import { setApiKey } from "@/lib/api"

// We override window.location.host so resolveWsUrl() — invoked inside the
// provider on apikeychange — produces the same host as our mock-socket
// server below. jsdom's default `localhost` is fine for the port-less form.

const HOST = "localhost:14567"
const SERVER_URL = `ws://${HOST}/ws`
const OLD_KEY = "oldkey"
const NEW_KEY = "newkey"

interface ServerHandle {
  server: Server
  /** Every client URL the server has accepted, in connect order. */
  urls: string[]
}

// mock-socket matches by host:port + path (NOT query string), so a single
// server can capture every reconnection regardless of which `?token=...`
// the client used.
function startServer(): ServerHandle {
  const server = new Server(SERVER_URL)
  const urls: string[] = []
  server.on("connection", (socket) => {
    urls.push((socket as unknown as MockClientWebSocket).url)
  })
  return { server, urls }
}

function Wrap({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return (
    <QueryClientProvider client={qc}>
      <HapticProvider>{children}</HapticProvider>
    </QueryClientProvider>
  )
}

describe("WebSocketProvider — api key rotation", () => {
  const realHost = window.location.host
  let serverHandle: ServerHandle | null = null

  beforeEach(() => {
    // Force window.location.host so resolveWsUrl() matches the mock server.
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, host: HOST, protocol: "http:" },
    })
    localStorage.setItem("apiKey", OLD_KEY)
    serverHandle = startServer()
  })

  afterEach(() => {
    serverHandle?.server.stop()
    serverHandle = null
    localStorage.clear()
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, host: realHost },
    })
    vi.restoreAllMocks()
  })

  it("reconnects with the new token when apikeychange fires", async () => {
    const initialUrl = `${SERVER_URL}?token=${encodeURIComponent(OLD_KEY)}`
    render(
      <Wrap>
        <WebSocketProvider url={initialUrl}>
          <div>child</div>
        </WebSocketProvider>
      </Wrap>,
    )

    await waitFor(() => expect(serverHandle!.urls.length).toBe(1))
    expect(serverHandle!.urls[0]).toContain(`token=${OLD_KEY}`)

    // Rotate via the canonical helper: writes localStorage AND emits the
    // apikeychange event the provider listens for.
    await act(async () => {
      setApiKey(NEW_KEY)
      // mock-socket dispatches connect asynchronously; let microtasks flush.
      await new Promise((r) => setTimeout(r, 0))
    })

    await waitFor(() => expect(serverHandle!.urls.length).toBeGreaterThanOrEqual(2))
    expect(serverHandle!.urls.at(-1)).toContain(`token=${NEW_KEY}`)
  })

  it("reconnects with no token when logging out (setApiKey(null))", async () => {
    const initialUrl = `${SERVER_URL}?token=${encodeURIComponent(OLD_KEY)}`
    render(
      <Wrap>
        <WebSocketProvider url={initialUrl}>
          <div>child</div>
        </WebSocketProvider>
      </Wrap>,
    )

    await waitFor(() => expect(serverHandle!.urls.length).toBe(1))

    await act(async () => {
      setApiKey(null)
      await new Promise((r) => setTimeout(r, 0))
    })

    await waitFor(() => expect(serverHandle!.urls.length).toBeGreaterThanOrEqual(2))
    // After logout the new URL must NOT carry the old token.
    expect(serverHandle!.urls.at(-1)).not.toContain(OLD_KEY)
  })
})

describe("setApiKey()", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it("writes the key and dispatches apikeychange", () => {
    const spy = vi.fn()
    window.addEventListener("apikeychange", spy)
    setApiKey("xyz")
    expect(localStorage.getItem("apiKey")).toBe("xyz")
    expect(spy).toHaveBeenCalledTimes(1)
    window.removeEventListener("apikeychange", spy)
  })

  it("removes the key on null and dispatches apikeychange", () => {
    localStorage.setItem("apiKey", "old")
    const spy = vi.fn()
    window.addEventListener("apikeychange", spy)
    setApiKey(null)
    expect(localStorage.getItem("apiKey")).toBeNull()
    expect(spy).toHaveBeenCalledTimes(1)
    window.removeEventListener("apikeychange", spy)
  })
})
