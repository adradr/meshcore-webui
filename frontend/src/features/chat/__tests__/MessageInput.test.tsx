import type React from "react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"
import { useState } from "react"

vi.mock("@/features/contacts/queries", () => ({
  useContacts: () => ({ data: {} }),
  useContact: () => ({ contact: undefined }),
  // Used by the AttachmentMenu adornment rendered inside MessageInput.
  useShareContact: () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock("@/features/channels/queries", () => ({
  useChannels: () => ({ data: [] }),
}))

// AttachmentMenu reads selfInfo for the "My contact info" + map-dialog
// seed coords; stub it out so the unit test stays focused on
// MessageInput's wiring.
vi.mock("@/features/device/queries", () => ({
  useSelfInfo: () => ({ data: undefined }),
}))

// Same reasoning as in AttachmentMenu.test.tsx — keep this unit test
// independent of the Leaflet stack.
vi.mock("../ShareLocationMapDialog", () => ({
  ShareLocationMapDialog: () => null,
}))

const sendMutate = vi.fn()
vi.mock("../useSendMessage", () => ({
  useSendMessage: () => ({ mutate: sendMutate, isPending: false }),
}))

const tapSpy = vi.fn()
vi.mock("@/haptics/HapticProvider", () => ({
  useHaptic: () => ({
    tap: tapSpy, select: vi.fn(), success: vi.fn(),
    warn: vi.fn(), error: vi.fn(), nudge: vi.fn(),
    enabled: true, setEnabled: vi.fn(),
  }),
  getGlobalHaptic: () => null,
}))

// Import AFTER mocks.
import { MessageInput } from "../MessageInput"

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  sendMutate.mockReset()
  tapSpy.mockReset()
})

describe("MessageInput — uncontrolled (default) behaviour", () => {
  it("typing into the textarea updates its own internal state", () => {
    render(wrap(<MessageInput channelIdx={0} />))
    const textarea = screen.getByPlaceholderText(/Message/i) as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: "hi there" } })
    expect(textarea.value).toBe("hi there")
  })

  it("fires haptic.tap() exactly once when submit runs", () => {
    render(wrap(<MessageInput channelIdx={0} />))
    const textarea = screen.getByPlaceholderText(/Message/i) as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: "hi" } })
    const sendBtn = screen.getByRole("button", { name: /send/i })
    fireEvent.click(sendBtn)
    expect(tapSpy).toHaveBeenCalledTimes(1)
    expect(sendMutate).toHaveBeenCalledTimes(1)
  })

  it("does NOT fire haptic.tap() when submit is blocked by empty text", () => {
    render(wrap(<MessageInput channelIdx={0} />))
    const sendBtn = screen.getByRole("button", { name: /send/i })
    // Button is disabled while text is empty — click is a no-op, no haptic.
    fireEvent.click(sendBtn)
    expect(tapSpy).not.toHaveBeenCalled()
    expect(sendMutate).not.toHaveBeenCalled()
  })
})

describe("MessageInput — controlled mode", () => {
  function Controlled({ initial = "" }: { initial?: string }) {
    const [value, setValue] = useState(initial)
    return (
      <>
        <div data-testid="parent-value">{value}</div>
        <MessageInput channelIdx={0} value={value} onChange={setValue} />
      </>
    )
  }

  it("edits propagate to parent onChange", () => {
    render(wrap(<Controlled />))
    const textarea = screen.getByPlaceholderText(/Message/i) as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: "ping" } })
    expect(screen.getByTestId("parent-value").textContent).toBe("ping")
    expect(textarea.value).toBe("ping")
  })
})

describe("MessageInput — seedKey focus bump", () => {
  function Harness() {
    const [value, setValue] = useState("")
    const [seedKey, setSeedKey] = useState(0)
    return (
      <>
        <button
          type="button"
          onClick={() => {
            setValue("@Alice ")
            setSeedKey((k) => k + 1)
          }}
        >
          seed
        </button>
        <MessageInput
          channelIdx={0}
          value={value}
          onChange={setValue}
          seedKey={seedKey}
        />
      </>
    )
  }

  it("focuses the textarea and reflects the new value when seedKey bumps", () => {
    render(wrap(<Harness />))
    const seedBtn = screen.getByRole("button", { name: /seed/i })
    act(() => {
      fireEvent.click(seedBtn)
    })
    const textarea = screen.getByPlaceholderText(/Message/i) as HTMLTextAreaElement
    expect(textarea.value).toBe("@Alice ")
    expect(document.activeElement).toBe(textarea)
  })
})

describe("MessageInput — AttachmentMenu wiring", () => {
  it("renders the + (Attach) button as the form's left adornment", () => {
    render(wrap(<MessageInput channelIdx={0} />))
    expect(screen.getByLabelText(/attach/i)).toBeTruthy()
  })

  it("inserts the geolocation snippet into the textarea via onInsert", async () => {
    // Stub navigator.geolocation BEFORE rendering. AttachmentMenu reads
    // the property at click time so this assignment is sufficient.
    const getCurrentPosition = vi.fn(
      (success: PositionCallback) =>
        success({
          coords: {
            latitude: 12.34567,
            longitude: 76.54321,
            accuracy: 1,
            altitude: null,
            altitudeAccuracy: null,
            heading: null,
            speed: null,
          },
          timestamp: Date.now(),
        } as GeolocationPosition),
    )
    Object.defineProperty(window.navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition },
    })

    render(wrap(<MessageInput channelIdx={0} />))
    const textarea = screen.getByPlaceholderText(
      /Message/i,
    ) as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: "look at this" } })

    await userEvent.click(screen.getByLabelText(/attach/i))
    await userEvent.click(screen.getByText(/my current position/i))

    await waitFor(() => {
      expect(textarea.value).toContain("look at this")
      expect(textarea.value).toContain("📍 12.34567, 76.54321")
    })
    // Newline separator between existing draft and the appended snippet.
    expect(textarea.value).toMatch(/look at this\n📍/)
  })
})
