import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { render, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Server } from "mock-socket"
import type { ReactNode } from "react"
import { WebSocketProvider } from "../WebSocketProvider"
import { HapticProvider } from "@/haptics/HapticProvider"

const URL = "ws://localhost:34567/ws"
const FULL = "ab".repeat(32)
const PREFIX = FULL.slice(0, 12)

interface Page {
  items: Record<string, unknown>[]
  next_cursor: string | null
}
interface Data {
  pages: Page[]
  pageParams: unknown[]
}

function wrap(qc: QueryClient, children: ReactNode) {
  return (
    <QueryClientProvider client={qc}>
      <HapticProvider>
        <WebSocketProvider url={URL}>{children}</WebSocketProvider>
      </HapticProvider>
    </QueryClientProvider>
  )
}

describe("WebSocketProvider — typed dispatch cache updates", () => {
  let server: Server
  let qc: QueryClient

  beforeEach(() => {
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    server = new Server(URL)
  })

  afterEach(() => {
    server.stop()
  })

  function broadcastOnConnect(frame: object) {
    server.on("connection", (socket) => {
      socket.send(JSON.stringify(frame))
    })
  }

  it("keys contact_message cache updates by the enriched full pubkey", async () => {
    broadcastOnConnect({
      type: "contact_message",
      payload: { text: "hello", pubkey: FULL, pubkey_prefix: PREFIX },
      attributes: {},
      topic: "messages",
    })
    render(wrap(qc, <div />))

    await waitFor(() => {
      const data = qc.getQueryData<Data>(["messages", FULL])
      expect(data?.pages[0]?.items[0]?.text).toBe("hello")
    })
    expect(qc.getQueryData(["messages", PREFIX])).toBeUndefined()
    const item = qc.getQueryData<Data>(["messages", FULL])!.pages[0].items[0]
    expect(item.contact_pub_key).toBe(FULL)
  })

  it("falls back to the prefix key when no full pubkey is on the wire", async () => {
    broadcastOnConnect({
      type: "contact_message",
      payload: { text: "legacy", pubkey_prefix: PREFIX },
      attributes: {},
      topic: "messages",
    })
    render(wrap(qc, <div />))

    await waitFor(() => {
      const data = qc.getQueryData<Data>(["messages", PREFIX])
      expect(data?.pages[0]?.items[0]?.text).toBe("legacy")
    })
  })

  it("ack_failed flips the matching cached message to failed in place", async () => {
    qc.setQueryData<Data>(["messages", FULL], {
      pages: [
        {
          items: [
            { id: 1, expected_ack_hex: "beef0001", ack_state: "pending" },
            { id: 2, expected_ack_hex: "cafe0002", ack_state: "pending" },
          ],
          next_cursor: null,
        },
      ],
      pageParams: [undefined],
    })
    broadcastOnConnect({
      type: "ack_failed",
      payload: { message_id: 1, code: "beef0001", contact_pub_key: FULL },
      attributes: {},
      topic: "messages",
    })
    render(wrap(qc, <div />))

    await waitFor(() => {
      const items = qc.getQueryData<Data>(["messages", FULL])!.pages[0].items
      expect(items[0].ack_state).toBe("failed")
    })
    const items = qc.getQueryData<Data>(["messages", FULL])!.pages[0].items
    expect(items[1].ack_state).toBe("pending")
  })

  it("ack_failed never downgrades an already-acked message", async () => {
    qc.setQueryData<Data>(["messages", FULL], {
      pages: [
        {
          items: [{ id: 1, expected_ack_hex: "beef0001", ack_state: "acked" }],
          next_cursor: null,
        },
      ],
      pageParams: [undefined],
    })
    broadcastOnConnect({
      type: "ack_failed",
      payload: { message_id: 1, code: "beef0001", contact_pub_key: FULL },
      attributes: {},
      topic: "messages",
    })
    render(wrap(qc, <div />))

    // Let the frame flush, then assert the state never flipped.
    await new Promise((r) => setTimeout(r, 100))
    const items = qc.getQueryData<Data>(["messages", FULL])!.pages[0].items
    expect(items[0].ack_state).toBe("acked")
  })
})
