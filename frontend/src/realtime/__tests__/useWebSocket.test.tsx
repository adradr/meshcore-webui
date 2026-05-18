import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { Server } from "mock-socket"
import { useWebSocket } from "../useWebSocket"

describe("useWebSocket", () => {
  let server: Server
  const URL = "ws://localhost:1234"

  beforeEach(() => {
    server = new Server(URL)
  })

  afterEach(() => {
    server.close()
  })

  it("opens connection and emits status=open", async () => {
    const { result } = renderHook(() => useWebSocket({ url: URL }))
    await waitFor(() => expect(result.current.status).toBe("open"))
  })

  it("captures broadcast messages as lastMessage", async () => {
    const { result } = renderHook(() => useWebSocket({ url: URL }))
    await waitFor(() => expect(result.current.status).toBe("open"))
    server.emit(
      "message",
      JSON.stringify({ type: "new_message", payload: { text: "hi" } }),
    )
    await waitFor(() =>
      expect((result.current.lastMessage as { type?: string })?.type).toBe(
        "new_message",
      ),
    )
  })
})
