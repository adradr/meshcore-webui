import { describe, expect, it, vi, beforeEach } from "vitest"
import { friendlyMessage, notifyError, notifySuccess } from "@/lib/notify"
import { toast } from "sonner"
import * as HapticProvider from "@/haptics/HapticProvider"

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

function apiError(opts: {
  status: number
  statusText?: string
  detail?: string
  message?: string
}): Error {
  const e = new Error(
    opts.message ??
      (opts.detail
        ? `${opts.status} ${opts.statusText ?? ""}: ${opts.detail}`
        : `${opts.status} ${opts.statusText ?? ""}`),
  ) as Error & {
    status?: number
    statusText?: string
    detail?: string
  }
  e.status = opts.status
  e.statusText = opts.statusText
  e.detail = opts.detail
  return e
}

describe("friendlyMessage", () => {
  it.each([
    [
      { status: 504, detail: "Path discovery: no reply from ee10f91c… within 15s — peer may be unreachable or not running advertised firmware" },
      "Path discover failed — peer didn't reply",
      "Path discover",
    ],
    [{ status: 401 }, "API key missing or invalid — check Settings", "Save"],
    [{ status: 403 }, "Not allowed", "Send"],
    [{ status: 404 }, "Send failed — not found", "Send"],
    [{ status: 503 }, "Mesh device disconnected", "Advert"],
    [{ status: 500 }, "Send failed — device error", "Send"],
    [
      { status: 200, detail: "" } as never,
      "Send failed",
      "Send",
    ],
  ])("%j → %s", (errOpts, expected, prefix) => {
    expect(friendlyMessage(prefix, apiError(errOpts as never))).toBe(expected)
  })

  it("falls back to a generic message for non-API errors", () => {
    expect(friendlyMessage("Send", new Error("boom"))).toBe("Send failed")
  })

  it("flags TypeError as likely-offline", () => {
    expect(friendlyMessage("Send", new TypeError("Failed to fetch"))).toBe(
      "Send failed — offline?",
    )
  })

  it("uses 422 detail when present", () => {
    expect(
      friendlyMessage(
        "Save",
        apiError({ status: 422, detail: "channel idx already in use" }),
      ),
    ).toBe("channel idx already in use")
  })
})

describe("notifyError", () => {
  beforeEach(() => {
    vi.mocked(toast.error).mockClear()
  })

  it("shows a friendly toast and logs raw details to console.debug", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {})
    const err = apiError({
      status: 504,
      detail: "Path discovery: no reply from ee10f91c… within 15s",
    })

    notifyError("Path discover", err)

    expect(toast.error).toHaveBeenCalledWith("Path discover failed — peer didn't reply")
    const call = debugSpy.mock.calls[0]
    expect(call[0]).toBe("[notify]")
    expect(call[1]).toMatchObject({
      prefix: "Path discover",
      status: 504,
      detail: "Path discovery: no reply from ee10f91c… within 15s",
    })
    debugSpy.mockRestore()
  })

  it("never leaks raw status code or pubkey hex into the toast", () => {
    notifyError(
      "Path discover",
      apiError({
        status: 504,
        detail:
          "Path discovery: no reply from ee10f91c1234… within 15s — peer may be unreachable",
      }),
    )
    const arg = vi.mocked(toast.error).mock.calls.at(-1)?.[0] as string
    expect(arg).not.toMatch(/504/)
    expect(arg).not.toMatch(/ee10f91c/)
    expect(arg).not.toMatch(/15s/)
  })

  it("fires haptic.error() at the same instant as the toast", () => {
    const errorSpy = vi.fn()
    vi.spyOn(HapticProvider, "getGlobalHaptic").mockReturnValue({
      tap: () => {}, select: () => {}, success: () => {},
      warn: () => {}, error: errorSpy, nudge: () => {},
      enabled: true, setEnabled: () => {},
    })
    notifyError("Send", apiError({ status: 500 }))
    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(toast.error).toHaveBeenCalled()
  })

  it("no-ops haptic when no provider is mounted (getGlobalHaptic → null)", () => {
    vi.spyOn(HapticProvider, "getGlobalHaptic").mockReturnValue(null)
    // Should NOT throw — the optional-chained call swallows the null.
    expect(() => notifyError("Send", apiError({ status: 500 }))).not.toThrow()
  })
})

describe("notifySuccess", () => {
  beforeEach(() => {
    vi.mocked(toast.success).mockClear()
  })

  it("fires haptic.success() and toast.success() with the message", () => {
    const successSpy = vi.fn()
    vi.spyOn(HapticProvider, "getGlobalHaptic").mockReturnValue({
      tap: () => {}, select: () => {}, success: successSpy,
      warn: () => {}, error: () => {}, nudge: () => {},
      enabled: true, setEnabled: () => {},
    })
    notifySuccess("Ping received")
    expect(successSpy).toHaveBeenCalledTimes(1)
    expect(toast.success).toHaveBeenCalledWith("Ping received")
  })
})
