import { describe, expect, it } from "vitest"
import {
  buildResubscribePayload,
  type SubscriptionLike,
} from "./resubscribePayload"

function fakeSub(endpoint: string): SubscriptionLike {
  return {
    endpoint,
    toJSON: () => ({
      endpoint,
      expirationTime: null,
      keys: { p256dh: "p".repeat(20), auth: "a".repeat(20) },
    }),
  }
}

describe("buildResubscribePayload", () => {
  it("uses the old subscription endpoint when present", () => {
    const payload = buildResubscribePayload(
      fakeSub("https://push.example/old"),
      fakeSub("https://push.example/new"),
    )
    expect(payload.old_endpoint).toBe("https://push.example/old")
    expect(payload.new.endpoint).toBe("https://push.example/new")
  })

  it("falls back to the new endpoint when oldSubscription is null (Chrome key invalidation)", () => {
    // The backend requires old_endpoint to be a valid URL — "" would 422
    // and silently break push. The new endpoint is a safe no-op delete.
    const payload = buildResubscribePayload(
      null,
      fakeSub("https://push.example/new"),
    )
    expect(payload.old_endpoint).toBe("https://push.example/new")
  })

  it("copies keys and expirationTime from toJSON()", () => {
    const payload = buildResubscribePayload(undefined, {
      endpoint: "https://push.example/n",
      toJSON: () => ({
        endpoint: "https://push.example/n",
        expirationTime: 123,
        keys: { p256dh: "dh", auth: "au" },
      }),
    })
    expect(payload.new).toEqual({
      endpoint: "https://push.example/n",
      keys: { p256dh: "dh", auth: "au" },
      expirationTime: 123,
    })
  })

  it("falls back to sub.endpoint and empty keys when toJSON is sparse", () => {
    const payload = buildResubscribePayload(null, {
      endpoint: "https://push.example/sparse",
      toJSON: () => ({}),
    })
    expect(payload.new.endpoint).toBe("https://push.example/sparse")
    expect(payload.new.keys).toEqual({ p256dh: "", auth: "" })
    expect(payload.new.expirationTime).toBeNull()
  })
})
