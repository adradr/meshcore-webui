import { beforeEach, describe, expect, it } from "vitest"
import "fake-indexeddb/auto"
import {
  stashPendingResubscribe,
  takePendingResubscribe,
} from "./pendingResubscribe"

// Reset the in-memory IndexedDB between tests so each one starts clean.
async function deleteDb(): Promise<void> {
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase("meshcore-pwa")
    req.onsuccess = () => resolve()
    req.onerror = () => resolve()
    req.onblocked = () => resolve()
  })
}

beforeEach(async () => {
  await deleteDb()
})

describe("pendingResubscribe", () => {
  it("stash then take returns the same payload", async () => {
    const payload = {
      old_endpoint: "https://push.example/old",
      new: {
        endpoint: "https://push.example/new",
        keys: { p256dh: "p".repeat(20), auth: "a".repeat(20) },
        expirationTime: null,
      },
    }
    await stashPendingResubscribe(payload)
    const taken = await takePendingResubscribe()
    expect(taken).toEqual(payload)
  })

  it("take returns null when nothing is stashed", async () => {
    const taken = await takePendingResubscribe()
    expect(taken).toBeNull()
  })

  it("take is destructive — second call returns null", async () => {
    const payload = { old_endpoint: "x", new: { endpoint: "y" } }
    await stashPendingResubscribe(payload)
    await takePendingResubscribe()
    const second = await takePendingResubscribe()
    expect(second).toBeNull()
  })

  it("stashing twice overwrites — only the latest survives", async () => {
    await stashPendingResubscribe({ first: true })
    await stashPendingResubscribe({ second: true })
    const taken = await takePendingResubscribe()
    expect(taken).toEqual({ second: true })
  })
})
