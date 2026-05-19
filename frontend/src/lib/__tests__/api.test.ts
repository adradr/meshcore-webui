import { beforeEach, describe, expect, it, vi } from "vitest"
import { api } from "@/lib/api"

describe("api error handling", () => {
  beforeEach(() => {
    global.fetch = vi.fn() as unknown as typeof fetch
  })

  it("includes backend detail in thrown error (JSON detail)", async () => {
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          detail: "Telemetry: no reply from deadbeef… within 15s",
        }),
        {
          status: 504,
          statusText: "Gateway Timeout",
          headers: { "content-type": "application/json" },
        },
      ),
    )
    await expect(api.get("/x")).rejects.toThrow(/no reply from deadbeef/)
  })

  it("includes raw body when response is not JSON", async () => {
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response("some plaintext error", {
        status: 500,
        statusText: "Internal Server Error",
      }),
    )
    await expect(api.get("/x")).rejects.toThrow(/some plaintext error/)
  })

  it("falls back to plain status when body is empty", async () => {
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response("", { status: 500, statusText: "Internal Server Error" }),
    )
    await expect(api.get("/x")).rejects.toThrow("500")
  })

  it("preserves the status code on the thrown error", async () => {
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: "nope" }), {
        status: 504,
        statusText: "Gateway Timeout",
        headers: { "content-type": "application/json" },
      }),
    )
    try {
      await api.get("/x")
      throw new Error("expected api.get to throw")
    } catch (e) {
      const err = e as Error & { status?: number }
      expect(err.status).toBe(504)
    }
  })
})
