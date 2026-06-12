import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { render, renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Server } from "mock-socket"
import type { ReactNode } from "react"
import { WebSocketProvider } from "../WebSocketProvider"
import { useWebSocket } from "../useWebSocket"
import { HapticProvider } from "@/haptics/HapticProvider"

const URL = "ws://localhost:24567/ws"

function wrap(qc: QueryClient, children: ReactNode) {
  return (
    <QueryClientProvider client={qc}>
      <HapticProvider>
        <WebSocketProvider url={URL}>{children}</WebSocketProvider>
      </HapticProvider>
    </QueryClientProvider>
  )
}

describe("useWebSocket — auth-rejection close codes", () => {
  let server: Server

  afterEach(() => {
    server?.stop()
  })

  it("stops reconnecting and calls onAuthFail on close 1008", async () => {
    server = new Server(URL)
    let connections = 0
    server.on("connection", (socket) => {
      connections += 1
      socket.close({ code: 1008, reason: "auth", wasClean: true })
    })

    const onAuthFail = vi.fn()
    const { result } = renderHook(() =>
      useWebSocket({ url: URL, onAuthFail }),
    )

    await waitFor(() => expect(onAuthFail).toHaveBeenCalledTimes(1))
    expect(result.current.status).toBe("closed")

    // Backoff for attempt 0 is ~1–1.5s; wait past it and assert no retry.
    await new Promise((r) => setTimeout(r, 1800))
    expect(connections).toBe(1)
  })

  it("keeps reconnecting on a transient close (non-auth code)", async () => {
    server = new Server(URL)
    let connections = 0
    server.on("connection", (socket) => {
      connections += 1
      if (connections === 1) {
        socket.close({ code: 1001, reason: "going away", wasClean: true })
      }
    })

    const onAuthFail = vi.fn()
    const { result } = renderHook(() =>
      useWebSocket({ url: URL, onAuthFail }),
    )

    await waitFor(
      () => expect(connections).toBeGreaterThanOrEqual(2),
      { timeout: 4000 },
    )
    await waitFor(() => expect(result.current.status).toBe("open"))
    expect(onAuthFail).not.toHaveBeenCalled()
  })
})

describe("WebSocketProvider — missed-event recovery on reconnect", () => {
  let server: Server
  let qc: QueryClient

  beforeEach(() => {
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  })

  afterEach(() => {
    server?.stop()
  })

  it("invalidates event-driven caches on reconnect, not on first open", async () => {
    server = new Server(URL)
    let connections = 0
    server.on("connection", (socket) => {
      connections += 1
      if (connections === 1) {
        // Drop the first connection after it opens → client reconnects.
        setTimeout(
          () => socket.close({ code: 1001, reason: "bye", wasClean: true }),
          50,
        )
      }
    })

    const invalidate = vi.spyOn(qc, "invalidateQueries")
    render(wrap(qc, <div>child</div>))

    await waitFor(
      () => expect(connections).toBeGreaterThanOrEqual(2),
      { timeout: 4000 },
    )

    await waitFor(() => {
      const keys = invalidate.mock.calls.map((c) =>
        JSON.stringify(c[0]?.queryKey),
      )
      expect(keys).toContain(JSON.stringify(["messages"]))
      expect(keys).toContain(JSON.stringify(["threads"]))
      expect(keys).toContain(JSON.stringify(["contacts"]))
      expect(keys).toContain(JSON.stringify(["rx-log"]))
    })
    // First open must NOT have invalidated: every invalidation happened
    // after the second connection was established.
    // (If first-open invalidated too we'd see calls before connections>=2,
    // which the spy timing above can't easily isolate — instead assert the
    // total count matches exactly one recovery sweep of 5 keys.)
    expect(invalidate.mock.calls.length).toBe(5)
  })
})

describe("WebSocketProvider — acknowledgement resolves in place", () => {
  let server: Server
  let qc: QueryClient

  beforeEach(() => {
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  })

  afterEach(() => {
    server?.stop()
  })

  it("sets ack_state on the matching cached message without blanket refetch", async () => {
    server = new Server(URL)
    let serverSocket: { send: (d: string) => void } | null = null
    server.on("connection", (socket) => {
      serverSocket = socket
    })

    const key = ["messages", "abcd1234"] as const
    qc.setQueryData(key, {
      pages: [
        {
          items: [
            {
              id: 1,
              text: "hi",
              ack_state: "pending",
              expected_ack_hex: "deadbeef",
              ack_received_at: null,
            },
            {
              id: 2,
              text: "other",
              ack_state: "pending",
              expected_ack_hex: "cafef00d",
              ack_received_at: null,
            },
          ],
          next_cursor: null,
        },
      ],
      pageParams: [undefined],
    })

    const invalidate = vi.spyOn(qc, "invalidateQueries")
    render(wrap(qc, <div>child</div>))
    await waitFor(() => expect(serverSocket).not.toBeNull())

    serverSocket!.send(
      JSON.stringify({
        type: "acknowledgement",
        payload: { code: "deadbeef" },
        attributes: {},
      }),
    )

    await waitFor(() => {
      const data = qc.getQueryData<{
        pages: { items: { id: number; ack_state: string }[] }[]
      }>(key)
      expect(data!.pages[0].items[0].ack_state).toBe("acked")
    })
    const data = qc.getQueryData<{
      pages: {
        items: { id: number; ack_state: string; ack_received_at: unknown }[]
      }[]
    }>(key)
    expect(data!.pages[0].items[0].ack_received_at).toBeTruthy()
    // Sibling message untouched.
    expect(data!.pages[0].items[1].ack_state).toBe("pending")

    // No blanket ["messages"] invalidation — only ["threads"].
    const keys = invalidate.mock.calls.map((c) =>
      JSON.stringify(c[0]?.queryKey),
    )
    expect(keys).not.toContain(JSON.stringify(["messages"]))
    expect(keys).toContain(JSON.stringify(["threads"]))
  })

  it("falls back to an active-only messages invalidation when no cached match", async () => {
    server = new Server(URL)
    let serverSocket: { send: (d: string) => void } | null = null
    server.on("connection", (socket) => {
      serverSocket = socket
    })

    const invalidate = vi.spyOn(qc, "invalidateQueries")
    render(wrap(qc, <div>child</div>))
    await waitFor(() => expect(serverSocket).not.toBeNull())

    serverSocket!.send(
      JSON.stringify({
        type: "acknowledgement",
        payload: { code: "ffffffff" },
        attributes: {},
      }),
    )

    await waitFor(() => {
      const call = invalidate.mock.calls.find(
        (c) => JSON.stringify(c[0]?.queryKey) === JSON.stringify(["messages"]),
      )
      expect(call).toBeTruthy()
      expect(call![0]?.refetchType).toBe("active")
    })
  })
})
